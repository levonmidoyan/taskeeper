import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { cn } from '@/utils/cn';

type MdNode = { type: string; children?: MdNode[] };

/**
 * Descriptions and comments were plain text before the editor existed, so "<div>" in one
 * is a word, not markup. react-markdown drops raw HTML; turning html nodes into text nodes
 * shows it literally instead (never as HTML — rehype-raw is deliberately not used).
 */
export function remarkHtmlAsText() {
  const walk = (node: MdNode) => {
    if (node.type === 'html') node.type = 'text';
    node.children?.forEach(walk);
  };
  return (tree: MdNode) => walk(tree);
}

const components: Components = {
  // react-markdown's default URL transform has already emptied unsafe hrefs
  // (javascript:, data:, …) by the time this runs.
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('md-content', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkHtmlAsText]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
