import React, { useState, useEffect } from 'react';

interface CategoryInfo {
    id: string;
    label: string;
}

const SubscriptionForm: React.FC = () => {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [categories, setCategories] = useState<CategoryInfo[]>([]);
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

    useEffect(() => {
        fetch('/api/categories')
            .then((r) => r.json())
            .then((data) => {
                if (Array.isArray(data.categories)) setCategories(data.categories);
            })
            .catch(() => {
                // fetch failed — hide checkboxes, submit with no categories (all papers)
            });
    }, []);

    const toggleCategory = (id: string) => {
        setSelectedCategories((prev) =>
            prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
        );
    };

    const handleSubscribe = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;

        setStatus('loading');
        try {
            const res = await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, categories: selectedCategories }),
            });
            const data = await res.json();

            if (res.ok) {
                setStatus('success');
                setMessage(data.message || 'Check your inbox for a confirmation email.');
                setEmail('');
                setSelectedCategories([]);
            } else {
                setStatus('error');
                setMessage(data.error || 'Subscription failed.');
            }
        } catch {
            setStatus('error');
            setMessage('Network error. Please try again.');
        }
    };

    return (
        <div className="mt-4 sm:mt-0">
            <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-2">
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
                    className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${
                        status === 'success'
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
            {categories.length > 0 && status !== 'success' && (
                <div className="mt-3">
                    <p className="text-xs text-slate-500 mb-2">
                        Subscribe to specific categories (leave all unchecked to receive everything):
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {categories.map((cat) => (
                            <label key={cat.id} className="flex items-center gap-1 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={selectedCategories.includes(cat.id)}
                                    onChange={() => toggleCategory(cat.id)}
                                    className="rounded"
                                    disabled={status === 'loading'}
                                />
                                <span className="text-xs text-slate-700">{cat.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SubscriptionForm;
