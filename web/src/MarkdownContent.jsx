import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./markdown.css";

const components = {
  a: ({ node, href, children, ...props }) =>
    href ? (
      <a
        {...props}
        href={href}
        target={href.startsWith("#") ? undefined : "_blank"}
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  table: ({ node, ...props }) => (
    <div
      className="markdown-table-scroll"
      role="region"
      aria-label="Markdown 표"
      tabIndex={0}
    >
      <table {...props} />
    </div>
  ),
  img: ({ node, ...props }) => <img {...props} loading="lazy" />,
};

export function MarkdownContent({ children }) {
  return (
    <div className="markdown-content">
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {children || ""}
      </Markdown>
    </div>
  );
}
