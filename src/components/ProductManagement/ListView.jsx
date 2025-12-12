import React, { useState } from 'react';

const ListView = ({
    products,
    onUpdateProduct,
    onRemoveProduct,
    selectedProducts,
    onSelectProduct,
    onSelectAll,
}) => {
    const [editingCell, setEditingCell] = useState(null);
    const [editValue, setEditValue] = useState('');

    const allSelected = products.length > 0 && selectedProducts.length === products.length;

    const handleCellEdit = (product, field) => {
        setEditingCell({ productId: product.tempId, field });
        setEditValue(product[field] ?? '');
    };

    const handleCellSave = (productId, field) => {
        onUpdateProduct(productId, field, editValue);
        setEditingCell(null);
    };

    const handleCellCancel = () => {
        setEditingCell(null);
        setEditValue('');
    };

    const isEditing = (productId, field) =>
        editingCell?.productId === productId && editingCell?.field === field;

    const getStockBadge = (product) => {
        if (!product.inventory?.tracked) {
            return { icon: '○', label: 'Not tracked', color: 'text-gray-500' };
        }
        const available = product.inventory?.available || 0;
        if (available === 0) return { icon: '⛔', label: 'Out', color: 'text-red-500' };
        if (available < 10) return { icon: '⚠', label: 'Low', color: 'text-yellow-500' };
        return { icon: '●', label: 'In stock', color: 'text-green-500' };
    };

    const getMarketplaceBadges = (product) => {
        const badges = [];
        if (product.marketplaces?.amazon?.enabled) badges.push('🟡');
        if (product.marketplaces?.ebay?.enabled) badges.push('🔵');
        if (product.marketplaces?.shopify?.enabled) badges.push('🟢');
        if (product.marketplaces?.etsy?.enabled) badges.push('🟠');
        return badges.length ? badges.join(' ') : '—';
    };

    return (
        <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-gray-900">
                    <tr className="border-b border-red-900/60 text-xs uppercase tracking-wide text-gray-400">
                        <th className="w-10 p-2 text-left">
                            <input
                                type="checkbox"
                                className="h-4 w-4 accent-red-500"
                                checked={allSelected}
                                onChange={(event) => onSelectAll(event.target.checked)}
                            />
                        </th>
                        <th className="w-16 p-2 text-left">Image</th>
                        <th className="p-2 text-left">SKU</th>
                        <th className="p-2 text-left">Product Name</th>
                        <th className="p-2 text-left">Category</th>
                        <th className="p-2 text-right">Price</th>
                        <th className="p-2 text-left">Stock</th>
                        <th className="p-2 text-center">Markets</th>
                        <th className="w-16 p-2 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {products.length === 0 ? (
                        <tr>
                            <td
                                className="p-8 text-center text-gray-500"
                                colSpan={9}
                            >
                                No products found
                            </td>
                        </tr>
                    ) : (
                        products.map((product) => {
                            const stockBadge = getStockBadge(product);
                            const isSelected = selectedProducts.includes(product.tempId);
                            return (
                                <tr
                                    key={product.tempId}
                                    className={`border-b border-red-900/30 transition-colors hover:bg-gray-900/50 ${
                                        isSelected ? 'bg-red-900/20' : ''
                                    }`}
                                >
                                    <td className="p-2">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 accent-red-500"
                                            checked={isSelected}
                                            onChange={() => onSelectProduct(product.tempId)}
                                        />
                                    </td>
                                    <td className="p-2">
                                        {product.imageUrl ? (
                                            <img
                                                src={product.imageUrl}
                                                alt={product.name || 'Product'}
                                                className="h-10 w-10 rounded border border-red-900 object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-10 w-10 items-center justify-center rounded border border-red-900 bg-gray-800 text-xs text-gray-600">
                                                📷
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-2">
                                        {isEditing(product.tempId, 'sku') ? (
                                            <input
                                                type="text"
                                                value={editValue}
                                                onChange={(event) => setEditValue(event.target.value)}
                                                onBlur={() => handleCellSave(product.tempId, 'sku')}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') handleCellSave(product.tempId, 'sku');
                                                    if (event.key === 'Escape') handleCellCancel();
                                                }}
                                                autoFocus
                                                className="w-full rounded border border-red-500 bg-gray-800 px-1 py-0.5 font-mono text-sm"
                                            />
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => handleCellEdit(product, 'sku')}
                                                className="cursor-pointer text-left font-mono text-sm text-gray-200 hover:text-red-300"
                                            >
                                                {product.sku || '—'}
                                            </button>
                                        )}
                                    </td>
                                    <td className="p-2">
                                        {isEditing(product.tempId, 'name') ? (
                                            <input
                                                type="text"
                                                value={editValue}
                                                onChange={(event) => setEditValue(event.target.value)}
                                                onBlur={() => handleCellSave(product.tempId, 'name')}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') handleCellSave(product.tempId, 'name');
                                                    if (event.key === 'Escape') handleCellCancel();
                                                }}
                                                autoFocus
                                                className="w-full rounded border border-red-500 bg-gray-800 px-1 py-0.5 text-sm"
                                            />
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => handleCellEdit(product, 'name')}
                                                className="cursor-pointer text-left text-sm text-gray-100 hover:text-red-300"
                                            >
                                                {product.name || 'Unnamed'}
                                            </button>
                                        )}
                                    </td>
                                    <td className="p-2 text-sm text-gray-400">
                                        {product.category || '—'}
                                    </td>
                                    <td className="p-2 text-right">
                                        {isEditing(product.tempId, 'unitPrice') ? (
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={editValue}
                                                onChange={(event) => setEditValue(event.target.value)}
                                                onBlur={() => handleCellSave(product.tempId, 'unitPrice')}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') handleCellSave(product.tempId, 'unitPrice');
                                                    if (event.key === 'Escape') handleCellCancel();
                                                }}
                                                autoFocus
                                                className="w-20 rounded border border-red-500 bg-gray-800 px-1 py-0.5 text-right text-sm"
                                            />
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => handleCellEdit(product, 'unitPrice')}
                                                className="cursor-pointer text-sm font-semibold text-green-400 hover:text-green-300"
                                            >
                                                £{Number(product.unitPrice || 0).toFixed(2)}
                                            </button>
                                        )}
                                    </td>
                                    <td className={`p-2 text-sm ${stockBadge.color}`}>
                                        {stockBadge.icon} {stockBadge.label}
                                        {product.inventory?.tracked && (
                                            <span className="ml-1 text-xs text-gray-500">
                                                ({product.inventory?.available || 0})
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-2 text-center text-sm">
                                        {getMarketplaceBadges(product)}
                                    </td>
                                    <td className="p-2 text-right">
                                        <button
                                            type="button"
                                            onClick={() => onRemoveProduct(product.tempId)}
                                            className="text-sm text-red-500 hover:text-red-400"
                                            title="Delete product"
                                        >
                                            🗑️
                                        </button>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
};

export default ListView;
