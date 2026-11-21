'use client';

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Command } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motionTransitions } from '../../lib/motion-tokens';

export interface ExpandableSearchProps {
  placeholder?: string;
  onSearch?: (query: string) => void;
  className?: string;
  /** Keys pressed in the field (arrow keys / Enter for a results list). */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Lets the parent focus the field (e.g. a keyboard shortcut). */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  collapsedWidth?: number;
  expandedWidth?: number;
  /** Shortcut hint shown at rest. */
  shortcut?: string;
}

export const ExpandableSearch: React.FC<ExpandableSearchProps> = ({
  placeholder = 'Search components, props...',
  onSearch,
  className,
  onKeyDown,
  inputRef: externalRef,
  collapsedWidth = 160,
  expandedWidth = 280,
  shortcut = 'K',
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [value, setValue] = useState('');
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? ownRef;

  const handleOpen = () => {
    setIsExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleClose = () => {
    setIsExpanded(false);
    setValue('');
    onSearch?.('');
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    onSearch?.(e.target.value);
  };

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <motion.div
        animate={{
          width: isExpanded ? expandedWidth : collapsedWidth,
          borderColor: isExpanded ? '#C4CCD6' : '#E4E8ED',
          backgroundColor: isExpanded ? '#FFFFFF' : '#F4F6F9',
        }}
        transition={motionTransitions.springSnappy}
        className="flex items-center h-9 px-3 rounded-full border shadow-xs cursor-text transition-colors max-w-full"
        onClick={handleOpen}
      >
        <Search className="w-3.5 h-3.5 text-[#8C96A1] shrink-0 mr-2" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onFocus={() => setIsExpanded(true)}
          onBlur={() => !value && setIsExpanded(false)}
          onKeyDown={onKeyDown}
          placeholder={isExpanded ? placeholder : 'Quick search...'}
          className="w-full bg-transparent text-xs sm:text-sm text-[#111927] placeholder-[#8C96A1] focus:outline-none"
        />
        <AnimatePresence>
          {value ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
              className="p-0.5 rounded text-[#8C96A1] hover:text-[#111927] transition-colors cursor-pointer"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white border border-[#E4E8ED] text-[10px] text-[#8C96A1] font-mono shrink-0 select-none"
            >
              <Command className="w-2.5 h-2.5" />
              <span>{shortcut}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
