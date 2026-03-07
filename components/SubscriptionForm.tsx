
import React, { useState } from 'react';

const SubscriptionForm: React.FC = () => {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');

    const handleSubscribe = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;

        setStatus('loading');
        try {
            const res = await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();

            if (res.ok) {
                setStatus('success');
                setMessage(data.message || 'Check your inbox for a confirmation email.');
                setEmail('');
            } else {
                setStatus('error');
                setMessage(data.error || 'Subscription failed.');
            }
        } catch (error) {
            setStatus('error');
            setMessage('Network error. Please try again.');
        }
    };

    return (
        <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-2 mt-4 sm:mt-0">
            <input
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[200px]"
                disabled={status === 'loading' || status === 'success'}
            />
            <button
                type="submit"
                disabled={status === 'loading' || status === 'success'}
                className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${status === 'success'
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                    } disabled:opacity-50`}
            >
                {status === 'loading' ? '...' : status === 'success' ? 'Subscribed!' : 'Subscribe'}
            </button>
            {status === 'error' && (
                <p className="text-red-500 text-xs mt-1 sm:mt-0 sm:ml-2 self-center">{message}</p>
            )}
        </form>
    );
};

export default SubscriptionForm;
