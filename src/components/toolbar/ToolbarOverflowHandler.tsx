import { useState, useRef, useEffect } from 'react';

interface ToolbarOverflowHandlerProps {
  children: React.ReactNode[];
  className?: string;
}

const OVERFLOW_BTN_WIDTH = 32;

export function ToolbarOverflowHandler({ children, className = '' }: ToolbarOverflowHandlerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(children.length);
  const [showOverflow, setShowOverflow] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !measureRef.current) return;

    const update = () => {
      const containerWidth = containerRef.current!.clientWidth;
      const measureChildren = Array.from(measureRef.current!.children) as HTMLElement[];

      let used = 0;
      let count = 0;

      for (let i = 0; i < measureChildren.length; i++) {
        const el = measureChildren[i];
        const gap = i > 0 ? 2 : 0;
        const itemWidth = el.getBoundingClientRect().width + gap;
        const hasMore = i < measureChildren.length - 1;
        const wouldNeedOverflowBtn = hasMore && used + itemWidth + OVERFLOW_BTN_WIDTH > containerWidth;

        if (used + itemWidth + (wouldNeedOverflowBtn ? OVERFLOW_BTN_WIDTH : 0) <= containerWidth) {
          used += itemWidth;
          count++;
        } else {
          break;
        }
      }

      setVisibleCount(count);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [children]);

  useEffect(() => {
    if (!showOverflow) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showOverflow]);

  const overflowCount = children.length - visibleCount;

  return (
    <>
      <div
        ref={measureRef}
        aria-hidden="true"
        className={className}
        style={{ position: 'fixed', top: -9999, left: -9999, visibility: 'hidden', pointerEvents: 'none' }}
      >
        {children}
      </div>

      <div ref={containerRef} className={`${className} relative`}>
        {children.slice(0, visibleCount)}

        {overflowCount > 0 && (
          <button
            id="toolbar-overflow-trigger"
            onClick={() => setShowOverflow((v) => !v)}
            className="ui-icon-button tbar-btn"
            title="More options"
          >
            <svg className="icon-base" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
            </svg>
          </button>
        )}

        {showOverflow && overflowCount > 0 && (
          <div id="toolbar-overflow-dropdown" className="drop" style={{ right: 0, left: 'auto', width: 192 }}>
            {children.slice(visibleCount).map((item, i) => (
              <div key={i} className="drop-item">
                {item}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
