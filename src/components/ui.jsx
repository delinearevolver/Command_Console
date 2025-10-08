import React from 'react';

export const Card = ({ children, className = '' }) => (
    <div className={`p-4 sm:p-6 border border-red-500 shadow-[0_0_15px_rgba(255,0,0,0.5)] bg-black bg-opacity-80 ${className}`}>
        {children}
    </div>
);

export const Input = ({ className = '', ...props }) => (
    <input
        className={`w-full p-2 bg-gray-900 border border-red-700 focus:border-red-500 focus:outline-none ${className}`}
        {...props}
    />
);

export const Button = ({ children, className = '', ...props }) => (
    <button
        className={`w-full p-2 bg-red-800 hover:bg-red-700 font-bold disabled:bg-red-900/50 disabled:cursor-not-allowed transition-colors ${className}`}
        {...props}
    >
        {children}
    </button>
);

export const Select = ({ children, className = '', ...props }) => (
    <select
        className={`w-full p-2 bg-gray-900 border border-red-700 focus:border-red-500 focus:outline-none appearance-none ${className}`}
        style={{
            backgroundImage: `url('data:image/svg+xml;charset=UTF-8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="%23ff0000" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708 .708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/></svg>')`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 0.5rem center',
        }}
        {...props}
    >
        {children}
    </select>
);

export const TextArea = ({ className = '', ...props }) => (
    <textarea
        className={`w-full p-2 bg-gray-900 border border-red-700 focus:border-red-500 focus:outline-none ${className}`}
        {...props}
    />
);

export const Label = ({ className = '', ...props }) => (
    <label {...props} className={`block text-xs uppercase tracking-wide text-gray-400 ${className}`} />
);
