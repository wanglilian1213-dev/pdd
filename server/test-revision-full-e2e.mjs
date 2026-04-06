// 完整端到端测试：用 service role 创建测试用户 → 签发 JWT → 真实后端 API → 数据库校验
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, readFileSync } from 'fs';

const SUPABASE_URL = 'https://rjnfctvauewstngqbvrz.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqbmZjdHZhdWV3c3RuZ3FidnJ6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY2Nzk0MSwiZXhwIjoyMDg5MjQzOTQxfQ.DtxJLrDWQEcXawEwODZHAGcoqMgKp63hAUq7z1aclrI';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqbmZjdHZhdWV3c3RuZ3FidnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2Njc5NDEsImV4cCI6MjA4OTI0Mzk0MX0.hko2P3G8xAqweNifjWxwOJzFfj2UaApPFROoEVPkDQE';
const API = 'https://app-production-c8a4.up.railway.app';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const log = (...a) => console.log('[e2e]', ...a);
const fail = (msg) => { console.error('[e2e] ❌', msg); process.exit(1); };

// 1. 创建临时测试用户
const email = `e2e-revision-${Date.now()}@test.local`;
const password = 'TestE2E_' + Date.now();
log('1. Creating test user:', email);

const { data: createRes, error: createErr } = await admin.auth.admin.createUser({
  email, password, email_confirm: true,
});
if (createErr) fail('createUser: ' + createErr.message);
const userId = createRes.user.id;
log('   userId =', userId);

async function cleanup() {
  log('[cleanup] removing test user', userId);
  try { await admin.auth.admin.deleteUser(userId); } catch (e) { console.error(e.message); }
}
process.on('uncaughtException', async (e) => { console.error(e); await cleanup(); process.exit(1); });

try {
  // 2. 登录拿 JWT
  log('2. Signing in to get JWT...');
  const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const signInJson = await signIn.json();
  if (!signInJson.access_token) fail('signIn: ' + JSON.stringify(signInJson));
  const jwt = signInJson.access_token;
  log('   JWT obtained, length:', jwt.length);

  // 3. 创建 user_profile + wallet（注意：后端 authMiddleware 可能也会自动创建）
  log('3. Creating user_profile + wallet (2000 credits)...');
  const { error: profErr } = await admin.from('user_profiles').insert({
    id: userId, email, status: 'active',
  });
  if (profErr && profErr.code !== '23505') fail('user_profile insert: ' + profErr.message);
  const { error: walletErr } = await admin.from('wallets').insert({
    user_id: userId, balance: 2000, frozen: 0,
  });
  if (walletErr && walletErr.code !== '23505') fail('wallet insert: ' + walletErr.message);
  log('   wallet ready');

  // 4. 构造一个小的文本材料当作"文章"（作为 .txt 上传，revisionMaterialService 会当作文本处理）
  log('4. Creating test material file...');
  const paperText = `Title: Impact of AI on Software Engineering

Abstract:
This paper discusses how AI tools like GitHub Copilot and Cursor are reshaping
software development. Productivity gains are evident but code quality concerns persist.

Introduction:
AI pair programmers became mainstream in 2023. Adoption grew rapidly.

Conclusion:
AI tools are here to stay. Engineers must adapt.
`;
  writeFileSync('/tmp/revision-material.txt', paperText);

  // 5. POST /api/revision/create multipart
  log('5. POST /api/revision/create');
  const fd = new FormData();
  fd.append('instructions', '请把这篇文章扩展到 500 字左右，添加一个关于代码审查的新段落，并用更学术的语气重写。');
  fd.append('files', new Blob([paperText], { type: 'text/plain' }), 'paper.txt');

  const createRes2 = await fetch(`${API}/api/revision/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: fd,
  });
  const createJson = await createRes2.json();
  log('   status:', createRes2.status);
  log('   body:', JSON.stringify(createJson).slice(0, 300));
  if (!createRes2.ok) fail('create failed');
  const revisionId = createJson.revision?.id || createJson.data?.id || createJson.id;
  if (!revisionId) fail('no revision id in response');
  log('   revisionId:', revisionId);

  // 6. 立即查数据库：revisions 行 + frozen_credits
  log('6. Checking DB state immediately after create...');
  const { data: revRow } = await admin.from('revisions').select('*').eq('id', revisionId).single();
  log('   revision row:', { status: revRow?.status, frozen_credits: revRow?.frozen_credits });
  const { data: walletRow } = await admin.from('wallets').select('*').eq('user_id', userId).single();
  log('   wallet:', { balance: walletRow?.balance, frozen: walletRow?.frozen });
  if (walletRow.frozen !== revRow.frozen_credits) fail('frozen mismatch');

  // 7. 轮询 current 直到完成
  log('7. Polling status until completed/failed...');
  let finalRevision = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const { data: row, error: pollErr } = await admin.from('revisions').select('*').eq('id', revisionId).single();
    if (pollErr || !row) {
      log(`   [${i * 5}s] poll transient error: ${pollErr?.message || 'null row'}, retrying...`);
      continue;
    }
    log(`   [${i * 5}s] status=${row.status} word_count=${row.word_count || '-'}`);
    if (row.status !== 'processing') { finalRevision = row; break; }
  }
  if (!finalRevision) fail('timed out after 5 minutes');
  if (finalRevision.status !== 'completed') {
    log('   failure_reason:', finalRevision.failure_reason);
    fail('revision did not complete: ' + finalRevision.status);
  }
  log('   ✅ completed, words:', finalRevision.word_count);

  // 8. 验证最终 wallet 状态
  const { data: finalWallet } = await admin.from('wallets').select('*').eq('user_id', userId).single();
  log('8. Final wallet:', { balance: finalWallet.balance, frozen: finalWallet.frozen });
  if (finalWallet.frozen !== 0) fail('frozen should be 0 after settlement');

  // 9. 验证 credit_ledger 流水
  const { data: ledger } = await admin.from('credit_ledger')
    .select('type, amount, description')
    .eq('reference_id', revisionId)
    .order('created_at', { ascending: true });
  log('9. credit_ledger entries:');
  for (const e of ledger || []) log('   ', e.type, e.amount, '-', e.description);

  // 10. 验证 revision_files 里有 output 文件
  const { data: files } = await admin.from('revision_files').select('*').eq('revision_id', revisionId);
  log('10. revision_files:', files?.map((f) => ({ cat: f.category, name: f.original_name, size: f.file_size })));
  const outputFile = files?.find((f) => f.category === 'revision_output');
  if (!outputFile) fail('no revision_output file');

  // 11. 通过 API 下载 Word
  log('11. Downloading output file via API...');
  const dlRes = await fetch(`${API}/api/revision/${revisionId}/file/${outputFile.id}/download`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const dlJson = await dlRes.json();
  log('   dl response:', JSON.stringify(dlJson).slice(0, 200));
  const signedUrl = dlJson.data?.url || dlJson.url;
  if (!signedUrl) fail('no signed url');
  const docRes = await fetch(signedUrl);
  const docBuf = Buffer.from(await docRes.arrayBuffer());
  writeFileSync('/tmp/revision-output.docx', docBuf);
  log('   downloaded', docBuf.length, 'bytes');

  // 12. 测试并发阻止：再提交一次应该失败（现在状态是 completed，应该能提交新的）
  // 但测试的是"同一时间只能一个 processing"，所以这条 revision 已经 completed，可以再提交
  log('12. Testing list/current endpoints...');
  const listRes = await fetch(`${API}/api/revision/list`, { headers: { Authorization: `Bearer ${jwt}` } });
  const listJson = await listRes.json();
  log('    list total:', listJson.data?.total || listJson.total);

  const currentRes = await fetch(`${API}/api/revision/current`, { headers: { Authorization: `Bearer ${jwt}` } });
  const currentJson = await currentRes.json();
  log('    current (should be null since completed):', JSON.stringify(currentJson).slice(0, 200));

  // 13. 测试获取单个 revision
  const getRes = await fetch(`${API}/api/revision/${revisionId}`, { headers: { Authorization: `Bearer ${jwt}` } });
  const getJson = await getRes.json();
  log('13. get by id status:', getJson.data?.revision?.status || getJson.revision?.status);

  log('\n✅ ALL END-TO-END TESTS PASSED');
  log('   Revision ID:', revisionId);
  log('   Final word count:', finalRevision.word_count);
  log('   Final wallet balance:', finalWallet.balance, '(started at 2000)');

} finally {
  await cleanup();
}
