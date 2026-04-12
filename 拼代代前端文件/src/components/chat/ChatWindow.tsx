import React, { useRef, useEffect } from 'react';
import { X, Send } from 'lucide-react';
import ChatMessage from './ChatMessage';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatWindowProps {
  messages: Message[];
  input: string;
  isLoading: boolean;
  remainingToday: number | null;
  error: string | null;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
}

export default function ChatWindow({
  messages,
  input,
  isLoading,
  remainingToday,
  error,
  onInputChange,
  onSend,
  onClose,
}: ChatWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const isLimitReached = remainingToday !== null && remainingToday <= 0;

  return (
    <div className="flex h-[520px] w-[380px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl max-md:fixed max-md:inset-4 max-md:h-auto max-md:w-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 bg-red-700 px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-white">AI 智能客服</span>
          {remainingToday !== null && (
            <span className="text-xs text-red-200">
              今日剩余 {remainingToday} 条
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-1 text-red-200 transition-colors hover:bg-red-600 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((msg, i) => (
          <div key={i}>
            <ChatMessage role={msg.role} content={msg.content} />
          </div>
        ))}
        {isLoading && <ChatMessage role="assistant" content="" isLoading />}
        <div ref={messagesEndRef} />
      </div>

      {/* Error toast */}
      {error && (
        <div className="mx-4 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-100 p-3">
        {isLimitReached ? (
          <div className="rounded-lg bg-gray-50 px-4 py-3 text-center text-sm text-gray-500">
            今日提问次数已用完，明天再来吧
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入你的问题..."
              rows={1}
              className="max-h-20 flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition-colors focus:border-red-300 focus:ring-1 focus:ring-red-200"
              disabled={isLoading}
            />
            <button
              onClick={onSend}
              disabled={isLoading || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-700 text-white transition-colors hover:bg-red-800 disabled:bg-gray-300"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
