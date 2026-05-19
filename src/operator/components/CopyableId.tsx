import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Check, Copy } from 'lucide-react';

const COPYABLE_ID_OPEN_EVENT = 'copyable-id-open';
const OPEN_DELAY_MS = 200;
const CLOSE_DELAY_MS = 200;

type CopyableIdProps = {
  value: string;
  label?: string;
  className?: string;
};

export function CopyableId({ value, label, className }: CopyableIdProps) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const instanceId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const display = label ?? formatShortId(value);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => () => {
    clearOpenTimer();
    clearCloseTimer();
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPopoverStyle(null);
      return undefined;
    }

    function positionPopover() {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;

      const margin = 8;
      const gap = 7;
      const triggerRect = trigger.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const maxLeft = Math.max(margin, viewportWidth - popoverRect.width - margin);
      const left = clamp(triggerRect.left, margin, maxLeft);
      const preferredTop = triggerRect.top - popoverRect.height - gap;
      const top = preferredTop >= margin
        ? preferredTop
        : Math.min(triggerRect.bottom + gap, viewportHeight - popoverRect.height - margin);
      const arrowLeft = clamp(
        triggerRect.left + triggerRect.width / 2 - left,
        12,
        Math.max(12, popoverRect.width - 12),
      );

      setPopoverStyle({
        left,
        top: Math.max(margin, top),
        visibility: 'visible',
        '--copyable-arrow-left': `${arrowLeft}px`,
      } as CSSProperties);
    }

    positionPopover();
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
    return () => {
      window.removeEventListener('resize', positionPopover);
      window.removeEventListener('scroll', positionPopover, true);
    };
  }, [open, value]);

  useEffect(() => {
    function handlePeerOpen(event: Event) {
      const detail = (event as CustomEvent<{ instanceId?: string }>).detail;
      if (detail?.instanceId !== instanceId) {
        clearCloseTimer();
        setOpen(false);
      }
    }

    window.addEventListener(COPYABLE_ID_OPEN_EVENT, handlePeerOpen);
    return () => window.removeEventListener(COPYABLE_ID_OPEN_EVENT, handlePeerOpen);
  }, [instanceId]);

  async function copyValue(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setCopied(await writeTextToClipboard(value));
  }

  function openPopover() {
    clearOpenTimer();
    clearCloseTimer();
    window.dispatchEvent(
      new CustomEvent(COPYABLE_ID_OPEN_EVENT, { detail: { instanceId } }),
    );
    setPopoverStyle(null);
    setOpen(true);
  }

  function scheduleOpen() {
    clearOpenTimer();
    clearCloseTimer();
    openTimerRef.current = window.setTimeout(() => {
      openPopover();
      openTimerRef.current = null;
    }, OPEN_DELAY_MS);
  }

  function clearOpenTimer() {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function scheduleClose() {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  }

  function handleBlur(event: FocusEvent<HTMLSpanElement>) {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      scheduleClose();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === 'Escape') {
      clearCloseTimer();
      setOpen(false);
    }
  }

  return (
    <span
      aria-label={value}
      className={`copyable-id ${open ? 'open' : ''} ${className ?? ''}`}
      onBlur={handleBlur}
      onClick={openPopover}
      onFocus={openPopover}
      onKeyDown={handleKeyDown}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
      ref={triggerRef}
      tabIndex={0}
    >
      <span className="copyable-id-short">{display}</span>
      <span
        className="copyable-id-popover"
        onMouseEnter={() => {
          clearOpenTimer();
          clearCloseTimer();
        }}
        onMouseLeave={scheduleClose}
        ref={popoverRef}
        role="tooltip"
        style={popoverStyle ?? { visibility: 'hidden' }}
      >
        <span className="copyable-id-full">{value}</span>
        <button
          aria-label={`Copy ${value}`}
          className="copyable-id-copy"
          onClick={copyValue}
          type="button"
        >
          {copied ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} strokeWidth={2.2} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </span>
    </span>
  );
}

export function formatShortId(value: string): string {
  return value.length > 13 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function writeTextToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back below for browser contexts that deny the async clipboard API.
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}
