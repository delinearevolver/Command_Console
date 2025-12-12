import React, { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Card, TextArea, Button } from './ui';

const RAGConsole = () => {
    const functions = getFunctions();
    const [query, setQuery] = useState('');
    const [answer, setAnswer] = useState('');
    const [loading, setLoading] = useState(false);
    const [topDocs, setTopDocs] = useState([]);

    const handleQuery = async (event) => {
        event.preventDefault();
        setLoading(true);
        setAnswer('');
        setTopDocs([]);

        try {
            const ragQuery = httpsCallable(functions, 'ragQuery');
            const response = await ragQuery({ query });
            setAnswer(response.data.answer);
            setTopDocs(response.data.topDocs);
        } catch (error) {
            setAnswer(`Error: ${error.message || error}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className="max-w-2xl mx-auto mt-10">
            <h2 className="text-xl font-bold mb-2 text-red-400">RAG Console</h2>
            <form onSubmit={handleQuery} className="flex flex-col gap-2">
                <TextArea
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Ask a question..."
                    rows={3}
                    required
                />
                <Button type="submit" disabled={loading || !query}>
                    {loading ? 'Thinking...' : 'Submit'}
                </Button>
            </form>
            {answer && (
                <div className="mt-4">
                    <div className="font-semibold text-red-300 mb-1">Answer:</div>
                    <div className="bg-gray-900 p-2 rounded border border-red-700 whitespace-pre-line">{answer}</div>
                </div>
            )}
            {topDocs.length > 0 && (
                <div className="mt-4">
                    <div className="font-semibold text-red-300 mb-1">Top Documents:</div>
                    <ul className="list-disc pl-5">
                        {topDocs.map((doc) => (
                            <li key={doc.id} className="mb-1">
                                <span className="text-red-400">Score: {doc.score.toFixed(3)}</span>
                                <div className="text-gray-300 text-sm">{doc.text}</div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </Card>
    );
};

export default RAGConsole;
