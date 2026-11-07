import React from 'react';
import { X } from 'lucide-react';

/** Bottom sheet used by the Budget page and its shared-expense panels. */
export const Sheet: React.FC<{ open: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({
    open, onClose, title, children,
}) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
                className="relative bg-background rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 className="text-lg font-semibold">{title}</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-surface-2 transition-colors" aria-label="Close">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-4">{children}</div>
            </div>
        </div>
    );
};
