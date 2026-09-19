import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Склеює класи й гасить конфлікти Tailwind (останній виграє). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
