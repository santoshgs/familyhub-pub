import React, { useEffect } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import './Dialog.css';

interface DialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    children: React.ReactNode;
    className?: string;
    viewportAware?: boolean;
}

export const Dialog: React.FC<DialogProps> = ({
    open,
    onOpenChange,
    title,
    description,
    children,
    className,
    viewportAware = false,
}) => {
    useEffect(() => {
        if (!open || !viewportAware) return;
        const viewport = window.visualViewport;
        const update = () => {
            const visibleHeight = viewport?.height ?? window.innerHeight;
            const visibleTop = viewport?.offsetTop ?? 0;
            document.documentElement.style.setProperty('--openfamily-keyboard-height', `${visibleHeight}px`);
            document.documentElement.style.setProperty('--openfamily-keyboard-top', `${visibleTop}px`);
            if (window.innerHeight - visibleHeight > 120) document.documentElement.dataset.softKeyboard = 'open';
            else delete document.documentElement.dataset.softKeyboard;
        };
        update();
        viewport?.addEventListener('resize', update);
        viewport?.addEventListener('scroll', update);
        window.addEventListener('resize', update);
        return () => {
            viewport?.removeEventListener('resize', update);
            viewport?.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
            document.documentElement.style.removeProperty('--openfamily-keyboard-height');
            document.documentElement.style.removeProperty('--openfamily-keyboard-top');
            delete document.documentElement.dataset.softKeyboard;
        };
    }, [open, viewportAware]);
    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm animate-fade-in" />
                <DialogPrimitive.Content
                    className={cn(
                        'fixed inset-x-0 bottom-0 z-50 w-full border border-border bg-card shadow-surface-hover animate-slide-up',
                        'max-h-[90vh] overflow-y-auto rounded-t-[20px] p-0',
                        'sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card',
                        className
                    )}
                    data-viewport-aware={viewportAware ? 'true' : undefined}
                >
                    <div className="flex items-start justify-between border-b border-border px-5 py-4 md:px-6">
                        <div className="pr-4">
                            <DialogPrimitive.Title className="text-h2 font-semibold">
                                {title}
                            </DialogPrimitive.Title>
                            {description && (
                                <DialogPrimitive.Description className="mt-1 text-caption text-muted-foreground">
                                    {description}
                                </DialogPrimitive.Description>
                            )}
                        </div>
                        <DialogPrimitive.Close className="rounded-input p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
                            <X className="h-5 w-5" />
                            <span className="sr-only">Fermer</span>
                        </DialogPrimitive.Close>
                    </div>
                    <div className="px-5 py-4 md:px-6 md:py-5">{children}</div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
};
