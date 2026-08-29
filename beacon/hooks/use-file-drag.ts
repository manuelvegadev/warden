"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Window-level drag & drop: returns true while files are dragged over the page; `onDrop` receives
 * them. Tracks enter/leave depth because the browser fires dragleave for every child element crossed.
 */
export function useFileDrag(enabled: boolean, onDrop: (files: FileList) => void) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  useEffect(() => {
    if (!enabled) return;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault(); // allow dropping anywhere on the page
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) dropRef.current(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [enabled]);
  return dragging;
}
