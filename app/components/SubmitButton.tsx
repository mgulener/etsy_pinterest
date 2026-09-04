"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: React.ReactNode;
  pendingText: string;
  className?: string;
  disabled?: boolean;
};

export function SubmitButton({
  children,
  pendingText,
  className,
  disabled = false
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" disabled={disabled || pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
