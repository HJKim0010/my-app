import type { ReactNode } from "react";

function renderInlineText(text: string, keyPrefix: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-strong-${index}`}>{part.slice(2, -2)}</strong>;
    }

    return <span key={`${keyPrefix}-text-${index}`}>{part.replace(/\*\*/g, "")}</span>;
  });
}

type MarkdownListItem = {
  text: string;
  children: MarkdownListItem[];
};

function parseListItems(lines: string[]): MarkdownListItem[] {
  const items: MarkdownListItem[] = [];
  let currentItem: MarkdownListItem | null = null;

  for (const line of lines) {
    const match = line.match(/^(\s*)(?:[-*]|\d+\.)\s+(.+)$/);

    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const item: MarkdownListItem = {
      text: match[2].trim(),
      children: [],
    };

    if (indent > 0 && currentItem) {
      currentItem.children.push(item);
      continue;
    }

    items.push(item);
    currentItem = item;
  }

  return items;
}

function renderListItems(items: MarkdownListItem[], keyPrefix: string): ReactNode {
  return items.map((item, index) => (
    <li key={`${keyPrefix}-item-${index}`}>
      {renderInlineText(item.text, `${keyPrefix}-item-${index}`)}
      {item.children.length > 0 ? (
        <ul>{renderListItems(item.children, `${keyPrefix}-child-${index}`)}</ul>
      ) : null}
    </li>
  ));
}

export function renderAssistantText(text: string, isStreaming = false, isError = false): ReactNode {
  const hasText = text.trim().length > 0;

  if (!hasText && isStreaming) {
    return (
      <div className="assistant-markdown assistant-response-streaming">
        <span className="stream-loading" aria-label="Assistant is writing">
          <span />
          <span />
          <span />
        </span>
      </div>
    );
  }

  if (!hasText) {
    return null;
  }

  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let index = 0;

  const isListLine = (line: string) => /^\s*(?:[-*]|\d+\.)\s+/.test(line);
  const isOrderedListLine = (line: string) => /^\s*\d+\.\s+/.test(line);
  const isHeadingLine = (line: string) => /^#{1,6}\s*/.test(line.trim());
  const isQuoteLine = (line: string) => line.trim().startsWith(">");
  const nextNonEmptyLine = (startIndex: number) => {
    for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
      if (lines[lineIndex].trim()) {
        return lines[lineIndex];
      }
    }

    return "";
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (isHeadingLine(line)) {
      nodes.push(
        <h3 key={`assistant-heading-${index}`}>
          {renderInlineText(trimmed.replace(/^#{1,6}\s*/, ""), `heading-${index}`)}
        </h3>
      );
      index += 1;
      continue;
    }

    if (isQuoteLine(line)) {
      const quoteLines: string[] = [];

      while (index < lines.length && isQuoteLine(lines[index])) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }

      nodes.push(
        <blockquote key={`assistant-quote-${index}`}>
          <p>{renderInlineText(quoteLines.join(" "), `quote-${index}`)}</p>
        </blockquote>
      );
      continue;
    }

    if (isListLine(line)) {
      const listLines: string[] = [];
      const ordered = isOrderedListLine(line);

      while (index < lines.length) {
        const currentLine = lines[index];

        if (!currentLine.trim()) {
          const nextLine = nextNonEmptyLine(index + 1);

          if (nextLine && isListLine(nextLine) && isOrderedListLine(nextLine) === ordered) {
            index += 1;
            continue;
          }

          break;
        }

        if (!isListLine(currentLine)) {
          break;
        }

        listLines.push(currentLine);
        index += 1;
      }

      nodes.push(
        ordered ? (
          <ol key={`assistant-ordered-list-${index}`}>
            {renderListItems(parseListItems(listLines), `ol-${index}`)}
          </ol>
        ) : (
          <ul key={`assistant-list-${index}`}>
            {renderListItems(parseListItems(listLines), `ul-${index}`)}
          </ul>
        )
      );
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length) {
      const currentLine = lines[index];

      if (
        !currentLine.trim() ||
        isHeadingLine(currentLine) ||
        isQuoteLine(currentLine) ||
        isListLine(currentLine)
      ) {
        break;
      }

      paragraphLines.push(currentLine.trim());
      index += 1;
    }

    nodes.push(
      <p key={`assistant-paragraph-${index}`}>
        {renderInlineText(paragraphLines.join(" "), `paragraph-${index}`)}
      </p>
    );
  }

  return (
    <div
      className={
        isError
          ? "assistant-markdown assistant-response-error"
          : "assistant-markdown"
      }
    >
      {nodes}
      {isStreaming ? <span className="stream-cursor" aria-hidden="true" /> : null}
    </div>
  );
}

