import React from "react";
import { ExternalLink } from "lucide-react";

export default function GoalReferenceLink({ url }) {
  try {
    if (!["http:", "https:"].includes(new URL(url).protocol)) return null;
  } catch {
    return null;
  }
  return (
    <a
      className="goal-reference-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <ExternalLink size={13} /> 기획서 열기
    </a>
  );
}
