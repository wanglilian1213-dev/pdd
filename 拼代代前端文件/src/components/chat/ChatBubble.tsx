import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import ChatWindow, { type Message } from './ChatWindow';

const WELCOME_MESSAGE: Message = {
  role: 'assistant',
  content: '你好！我是拼代代 AI 客服，有什么可以帮你的吗？',
};

export default function ChatBubble() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingToday, setRemainingToday] = useState<number | null>(null);

  if (!user) return null;

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput('');
    setError(null);

    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      // Send last 20 messages as history (excluding welcome)
      const historyToSend = [...messages, userMsg]
        .filter(m => m !== WELCOME_MESSAGE)
        .slice(-20)
        .map(m => ({ role: m.role, content: m.content }));

      const result = await api.sendChatMessage(text, historyToSend);
      setMessages(prev => [...prev, { role: 'assistant', content: result.reply }]);
      setRemainingToday(result.remainingToday);
    } catch (err: any) {
      const msg = err?.message || '发送失败，请稍后重试。';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[80]">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.2 }}
            className="mb-4"
          >
            <ChatWindow
              messages={messages}
              input={input}
              isLoading={isLoading}
              remainingToday={remainingToday}
              error={error}
              onInputChange={setInput}
              onSend={handleSend}
              onClose={() => setIsOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-red-700 text-white shadow-lg transition-all hover:bg-red-800 hover:shadow-xl"
      >
        {isOpen ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </div>
  );
}
