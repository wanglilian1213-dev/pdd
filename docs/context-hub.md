# Context Hub 使用说明

## 这东西是干什么的

`Context Hub` 可以理解成一个“开发查资料工具”。它不是给用户用的，也不是网站功能的一部分。它的作用是：在改第三方服务接入的时候，先把最新版文档拉出来，少靠记忆，少踩旧教程的坑。

对这个项目最有用的场景：

- 改 `OpenAI` 调用方式
- 改 `Supabase` 登录、数据库、文件存储
- 改 `Vite` 构建配置
- 改 `Express` 中间件或路由接法

## 什么时候必须先查

遇到下面这些情况，先查再写：

- 第一次接某个第三方服务
- 以前能跑，但现在要升级版本
- 参数名字、调用方式、返回格式不确定
- 涉及上传文件、登录、扣费、回调这种容易踩坑的地方

## 最常用的命令

### 1. 先搜索

```bash
npx -y @aisuite/chub search openai
npx -y @aisuite/chub search supabase
npx -y @aisuite/chub search vite
npx -y @aisuite/chub search express
```

### 2. 再拿具体文档

这个项目主要用 `JavaScript / TypeScript`，所以一般带上 `--lang js`。

```bash
npx -y @aisuite/chub get openai/chat --lang js
npx -y @aisuite/chub get supabase/client --lang js
npx -y @aisuite/chub get vite/vite --lang js
npx -y @aisuite/chub get express/express --lang js
```

### 3. 给文档记“本机备注”

这个功能适合记“我们这个项目踩过的坑”。

```bash
npx -y @aisuite/chub annotate openai/chat "这里写项目里踩过的坑"
npx -y @aisuite/chub annotate --list
```

如果某条备注过时了，可以清掉：

```bash
npx -y @aisuite/chub annotate openai/chat --clear
```

## 这个项目里怎么用最合适

建议固定成下面这个顺序：

1. 先看 `agent.md`
2. 如果要改第三方接入，先跑 `Context Hub`
3. 确认当前推荐写法后，再动代码
4. 如果这次踩了新坑，补一条本机备注

## 备注里能写什么，不能写什么

可以写：

- 我们项目里验证过的正确接法
- 某个接口的坑点
- 某类报错出现的原因
- 哪些字段不能混着传

不能写：

- API Key
- 密码
- Token
- 数据库密钥
- 任何线上敏感信息

一句话原则：备注里只记“经验”，不记“秘密”。

## 当前项目已知适用范围

目前确认最值得先查的是：

- `openai/chat`
- `supabase/client`
- `vite/vite`
- `express/express`

`Railway` 这块当前在 `Context Hub` 里没有直接搜到可用资料，所以部署问题还是以 Railway 官方文档和真实线上环境为准。
