import React from 'react';

import {
  buildSentenceHighlightSegments,
  sentenceScoreLabel,
  type SentenceAnalysisResultJson,
} from '../../lib/sentenceAnalysis';

export type {
  SentenceAnalysisResultJson,
  SentenceAnalysisSentence,
} from '../../lib/sentenceAnalysis';

interface SentenceHighlightsProps {
  result?: SentenceAnalysisResultJson | null;
  title?: string;
  emptyLabel?: string;
  displayTextOverride?: string | null;
}

export function SentenceHighlights({
  result,
  title = '逐句结果',
  emptyLabel = '暂时没有逐句结果。',
  displayTextOverride,
}: SentenceHighlightsProps) {
  const mergedResult = displayTextOverride?.trim()
    ? {
        ...(result || {}),
        display_text: displayTextOverride.trim(),
      }
    : result;

  const segments = buildSentenceHighlightSegments(mergedResult);

  if (segments.length === 0) {
    return (
      <div className="border border-gray-200 bg-white rounded-lg p-4 text-sm text-gray-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="border border-gray-200 bg-white rounded-lg p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <p className="text-xs text-gray-500 mt-1">按文章原样展示，绿色更像人写，红色代表这一句还偏 AI。</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center rounded-md bg-emerald-50 px-2.5 py-1 text-emerald-700 border border-emerald-200">
            绿色：通过
          </span>
          <span className="inline-flex items-center rounded-md bg-red-50 px-2.5 py-1 text-red-700 border border-red-200">
            红色：偏 AI
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-5">
        <div className="whitespace-pre-wrap text-sm leading-8 text-gray-900">
          {segments.map((segment, index) => {
            if (segment.kind === 'plain') {
              return <React.Fragment key={`plain-${index}`}>{segment.text}</React.Fragment>;
            }

            const human = segment.kind === 'human';
            const scoreLabel = sentenceScoreLabel(segment.score);
            const titleLabel = `${human ? '通过' : '偏 AI'}${scoreLabel ? ` · ${scoreLabel}` : ''}`;

            return (
              <span
                key={`${segment.kind}-${index}`}
                title={titleLabel}
                className={`box-decoration-clone px-0.5 ${
                  human
                    ? 'bg-emerald-100/90 text-gray-900'
                    : 'bg-red-100/90 text-gray-900'
                }`}
              >
                {segment.text}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
