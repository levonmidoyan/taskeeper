import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { MentionMember } from '@/components/kibo-ui/editor/mention';
import { MENTION_SCHEME, mentionTarget, nodeText } from '@/lib/mentions';
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

/** react-markdown empties unknown schemes; mention: is ours and never becomes an href. */
const urlTransform = (url: string) => (url.startsWith(MENTION_SCHEME) ? url : defaultUrlTransform(url));

function buildComponents(members?: MentionMember[], currentUserId?: string): Components {
  return {
    // react-markdown's URL transform has already emptied unsafe hrefs
    // (javascript:, data:, …) by the time this runs.
    a: ({ href, children, node }) => {
      if (href?.startsWith(MENTION_SCHEME)) {
        // Chip only what notifies (the same rule); any other mention: link is just its text.
        const id = mentionTarget(href, node ? nodeText(node) : '');
        if (!id) return <>{children}</>;
        const name = members?.find((m) => m.userId === id)?.name;
        return (
          <span className="mention" {...(id === currentUserId ? { 'data-self': '' } : {})}>
            {name ? `@${name}` : children}
          </span>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
    // A remote image would load in every viewer's browser, telling its host who read the
    // task and when. The editor cannot make images, so show them as links.
    img: ({ src, alt }) => {
      const href = typeof src === 'string' ? src : undefined;
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {alt || href}
        </a>
      );
    },
  };
}

export function Markdown({
  children, className, members, currentUserId,
}: { children: string; className?: string; members?: MentionMember[]; currentUserId?: string }) {
  return (
    <div className={cn('md-content', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkHtmlAsText]}
        components={buildComponents(members, currentUserId)}
        urlTransform={urlTransform}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
