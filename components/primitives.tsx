"use client";
// Primitives that preserve the prototype's inline-style approach in React.
// - css(): parse a CSS declaration string into a React style object (so ported
//   style strings can be copied over verbatim).
// - Box: a div/span that supports `styleHover` (the old `style-hover`) via hover
//   state, and — when given onClick — becomes a keyboard-activatable role="button".
// - Btn: a real <button> with hover support and the base transition/active styles.
import React, { useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from "react";

export type Style = string | CSSProperties;

export function css(input?: Style): CSSProperties {
  if (!input) return {};
  if (typeof input !== "string") return input;
  const o: Record<string, string> = {};
  for (const decl of input.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const val = decl.slice(i + 1).trim();
    if (!prop) continue;
    const key = prop.startsWith("--") ? prop : prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    // Expand the `border` shorthand to longhand so a base `border:1px solid X`
    // never coexists with a hover `borderColor` override (mixing shorthand and
    // longhand for the same value triggers a React styling warning on rerender).
    const bm = key === "border" && val.match(/^(\S+)\s+(solid|dashed|dotted|double|none)(?:\s+(.+))?$/);
    if (bm) {
      o.borderWidth = bm[1];
      o.borderStyle = bm[2];
      if (bm[3]) o.borderColor = bm[3];
      continue;
    }
    o[key] = val;
  }
  return o as CSSProperties;
}

interface BoxProps {
  as?: "div" | "span";
  style?: Style;
  styleHover?: Style;
  onClick?: (e: MouseEvent | KeyboardEvent) => void;
  // Suppress role="button"/tabindex/keyboard — for clickable containers that
  // already hold their own real buttons (avoids nested interactive controls).
  noButton?: boolean;
  children?: ReactNode;
  // aria-*, id, title, etc.
  [key: string]: unknown;
}

export function Box({ as = "div", style, styleHover, onClick, noButton, children, ...rest }: BoxProps) {
  const [hover, setHover] = useState(false);
  const Tag = as;
  const merged: CSSProperties = { ...css(style), ...(hover && styleHover ? css(styleHover) : {}) };
  const hoverProps = styleHover
    ? { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) }
    : {};
  // Clickable non-button elements become keyboard-activatable role="button"s.
  const a11y = onClick && !noButton
    ? {
        role: "button" as const,
        tabIndex: 0,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick(e);
          }
        },
      }
    : {};
  return (
    <Tag style={merged} onClick={onClick} {...hoverProps} {...a11y} {...(rest as Record<string, unknown>)}>
      {children}
    </Tag>
  );
}

interface BtnProps {
  style?: Style;
  styleHover?: Style;
  onClick?: (e: MouseEvent) => void;
  children?: ReactNode;
  [key: string]: unknown;
}

export function Btn({ style, styleHover, children, ...rest }: BtnProps) {
  const [hover, setHover] = useState(false);
  const merged: CSSProperties = {
    transition: "transform .12s ease,background .15s ease,box-shadow .15s ease",
    ...css(style),
    ...(hover && styleHover ? css(styleHover) : {}),
  };
  return (
    <button
      style={merged}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </button>
  );
}
