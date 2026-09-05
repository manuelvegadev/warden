"use client";

import { type DragEvent, useRef, useState } from "react";
import { hasFiles } from "@/hooks/use-file-drag";

/**
 * Element-scoped drag & drop of files: spread `handlers` on the element, `over` is true while
 * files are dragged across it. The counterpart of `useFileDrag`, which listens on the window.
 * Enter/leave depth is tracked because the browser fires dragleave for every child crossed, and
 * events stop at the element so zones can nest (a column inside the page) without both firing.
 */
export function useDropZone(enabled: boolean, onDrop: (files: FileList) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const onDragEnter = (e: DragEvent) => {
    if (!enabled || !hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth.current += 1;
    setOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!enabled || !hasFiles(e)) return;
    e.stopPropagation();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const onDragOver = (e: DragEvent) => {
    if (!enabled || !hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: DragEvent) => {
    if (!enabled || !hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth.current = 0;
    setOver(false);
    if (e.dataTransfer.files.length) onDrop(e.dataTransfer.files);
  };

  return { over, handlers: { onDragEnter, onDragLeave, onDragOver, onDrop: handleDrop } };
}
