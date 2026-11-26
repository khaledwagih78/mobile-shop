import ReactMarkdown from 'react-markdown';

export default function MarkdownView({ content, style = {} }) {
  if (!content) return null;

  return (
    <div className="markdown-body-custom" style={{ lineHeight: 1.85, fontSize: 14.5, color: '#15252b', ...style }}>
      <ReactMarkdown
        components={{
          h1: ({ node, ...props }) => <h1 style={{ fontSize: 19, fontWeight: 700, margin: '14px 0 8px 0', color: 'var(--primary, #0f4c5c)' }} {...props} />,
          h2: ({ node, ...props }) => <h2 style={{ fontSize: 17, fontWeight: 700, margin: '12px 0 6px 0', color: 'var(--primary, #0f4c5c)', borderBottom: '1px solid var(--line, #e2e8f0)', paddingBottom: 4 }} {...props} />,
          h3: ({ node, ...props }) => <h3 style={{ fontSize: 15.5, fontWeight: 700, margin: '10px 0 4px 0', color: '#15252b' }} {...props} />,
          p: ({ node, ...props }) => <p style={{ margin: '6px 0' }} {...props} />,
          ul: ({ node, ...props }) => <ul style={{ paddingRight: 20, margin: '6px 0' }} {...props} />,
          ol: ({ node, ...props }) => <ol style={{ paddingRight: 20, margin: '6px 0' }} {...props} />,
          li: ({ node, ...props }) => <li style={{ margin: '3px 0' }} {...props} />,
          strong: ({ node, ...props }) => <strong style={{ fontWeight: 700, color: '#15252b' }} {...props} />,
          em: ({ node, ...props }) => <em style={{ fontStyle: 'italic', opacity: 0.9 }} {...props} />,
          hr: ({ node, ...props }) => <hr style={{ border: 'none', borderTop: '1px solid var(--line, #e2e8f0)', margin: '14px 0' }} {...props} />,
          code: ({ node, inline, ...props }) => (
            <code
              style={{
                background: 'rgba(15, 76, 92, 0.08)',
                color: 'var(--primary, #0f4c5c)',
                padding: '2px 6px',
                borderRadius: 4,
                fontFamily: 'monospace',
                fontSize: '0.92em',
                fontVariantNumeric: 'tabular-nums',
              }}
              {...props}
            />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote
              style={{
                borderRight: '4px solid var(--primary, #0f4c5c)',
                margin: '10px 0',
                padding: '6px 14px',
                background: 'rgba(15, 76, 92, 0.04)',
                borderRadius: '0 8px 8px 0',
                color: '#334155',
              }}
              {...props}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
