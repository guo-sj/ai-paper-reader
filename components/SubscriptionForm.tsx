import React, { useState, useEffect } from 'react';

interface CategoryInfo {
    id: string;
    label: string;
}

const SubscriptionForm: React.FC = () => {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');
    const [categories, setCategories] = useState<CategoryInfo[]>([]);
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    const [showToast, setShowToast] = useState(false);

    useEffect(() => {
        fetch('/api/categories')
            .then((r) => r.json())
            .then((data) => {
                if (Array.isArray(data.categories)) setCategories(data.categories);
            })
            .catch(() => {});
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
        setErrorMessage('');
        try {
            const res = await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, categories: selectedCategories }),
            });
            const data = await res.json();

            if (res.ok) {
                setEmail('');
                setSelectedCategories([]);
                setStatus('idle');
                setShowToast(true);
                setTimeout(() => setShowToast(false), 2000);
            } else {
                setStatus('error');
                setErrorMessage(data.error || 'Subscription failed.');
            }
        } catch {
            setStatus('error');
            setErrorMessage('Network error. Please try again.');
        }
    };

    return (
        <div className="mt-4 sm:mt-0">
            {showToast && (
                <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm font-medium px-5 py-3 rounded-lg shadow-lg">
                    订阅成功
                </div>
            )}
            <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-2">
                <input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[200px]"
                    disabled={status === 'loading'}
                />
                <button
                    type="submit"
                    disabled={status === 'loading'}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                >
                    {status === 'loading' ? '...' : 'Subscribe'}
                </button>
                {status === 'error' && (
                    <p className="text-red-500 text-xs mt-1 sm:mt-0 sm:ml-2 self-center">{errorMessage}</p>
                )}
            </form>
            {categories.length > 0 && (
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
