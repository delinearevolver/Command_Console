import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, useAuth, useData } from '../App';
import { Card, Input, Button, Select, TextArea } from './ui';
import ProductGallery from './ProductGallery';
import ListView from './ProductManagement/ListView';
import FilterBar from './ProductManagement/FilterBar';

const randomId = () => {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (error) {
        return Math.random().toString(36).slice(2);
    }
    return Math.random().toString(36).slice(2);
};

const toEditableProduct = (product = {}) => ({
    tempId: product.tempId || product.id || randomId(),
    id: product.id || null,
    sku: product.sku || '',
    name: product.name || '',
    description: product.description || '',
    category: product.category || '',
    unitPrice: Number(product.unitPrice) || 0,
    taxRate: Number(product.taxRate) || 0,
    defaultQuantity: Number(product.defaultQuantity) || 1,
    boxQuantity: product.boxQuantity ?? '',
    imageUrl: product.imageUrl || '',
    imagePath: product.imagePath || '',
    thumbnailUrl: product.thumbnailUrl || '',
    inventory: {
        tracked: product.inventory?.tracked || false,
        totalQuantity: Number(product.inventory?.totalQuantity) || 0,
        allocated: Number(product.inventory?.allocated) || 0,
        available: Number(product.inventory?.available) || 0,
    },
    marketplaces: {
        amazon: { enabled: product.marketplaces?.amazon?.enabled || false },
        ebay: { enabled: product.marketplaces?.ebay?.enabled || false },
        shopify: { enabled: product.marketplaces?.shopify?.enabled || false },
        etsy: { enabled: product.marketplaces?.etsy?.enabled || false },
    }
});

const toEditableService = (service = {}) => ({
    tempId: service.tempId || service.id || randomId(),
    id: service.id || null,
    sku: service.sku || '',
    name: service.name || '',
    description: service.description || '',
    category: service.category || '',
    pricingType: service.pricingType || 'fixed',
    unitPrice: Number(service.unitPrice) || 0,
    taxRate: Number(service.taxRate) || 0,
    estimatedDuration: service.estimatedDuration || '',
    defaultQuantity: Number(service.defaultQuantity) || 1,
});

const CatalogueConsole = () => {
    const { user } = useAuth();
    const { products = [], services = [], productPriceBooks = [] } = useData();
    const [activeTab, setActiveTab] = useState('products');
    const [productsDraft, setProductsDraft] = useState([]);
    const [servicesDraft, setServicesDraft] = useState([]);
    const [productsHasUnsavedChanges, setProductsHasUnsavedChanges] = useState(false);
    const [servicesHasUnsavedChanges, setServicesHasUnsavedChanges] = useState(false);
    const [productMessage, setProductMessage] = useState(null);
    const [serviceMessage, setServiceMessage] = useState(null);
    const [productsRemovedIds, setProductsRemovedIds] = useState([]);
    const [servicesRemovedIds, setServicesRemovedIds] = useState([]);
    const [productsView, setProductsView] = useState('list');
    const [productsSearchTerm, setProductsSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [sortBy, setSortBy] = useState('name-asc');
    const [selectedProducts, setSelectedProducts] = useState([]);

    const addButtonRefs = useRef({ products: null, services: null });

    const tabs = useMemo(() => ([
        { id: 'products', label: 'Products' },
        { id: 'services', label: 'Services' },
        { id: 'marketplace', label: 'Marketplace' },
    ]), []);

    useEffect(() => {
        // Clear any transient messages when switching tabs to keep the UI tidy.
        if (activeTab === 'products') {
            setServiceMessage(null);
        } else if (activeTab === 'services') {
            setProductMessage(null);
        }
    }, [activeTab]);

    useEffect(() => {
        // Provide a subtle affordance by focusing the primary action button when tabs change.
        const ref = addButtonRefs.current[activeTab];
        if (ref && typeof ref.focus === 'function') {
            ref.focus();
        }
    }, [activeTab]);

    useEffect(() => {
        if (!productsHasUnsavedChanges) {
            setProductsDraft((products || []).map(toEditableProduct));
            setProductsRemovedIds([]);
            setSelectedProducts([]);
        }
    }, [products, productsHasUnsavedChanges]);

    useEffect(() => {
        if (!servicesHasUnsavedChanges) {
            setServicesDraft((services || []).map(toEditableService));
            setServicesRemovedIds([]);
        }
    }, [services, servicesHasUnsavedChanges]);

    const categories = useMemo(() => {
        const set = new Set();
        (products || []).forEach(product => {
            if (product?.category) {
                set.add(product.category);
            }
        });
        productsDraft.forEach(product => {
            if (product?.category) {
                set.add(product.category);
            }
        });
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [products, productsDraft]);

    const filteredAndSortedProducts = useMemo(() => {
        let result = productsDraft;

        if (productsSearchTerm.trim()) {
            const term = productsSearchTerm.toLowerCase();
            result = result.filter(product =>
                product.name?.toLowerCase().includes(term) ||
                product.sku?.toLowerCase().includes(term) ||
                product.description?.toLowerCase().includes(term) ||
                product.category?.toLowerCase().includes(term)
            );
        }

        if (categoryFilter) {
            result = result.filter(product => product.category === categoryFilter);
        }

        result = [...result].sort((a, b) => {
            switch (sortBy) {
                case 'name-asc':
                    return (a.name || '').localeCompare(b.name || '');
                case 'name-desc':
                    return (b.name || '').localeCompare(a.name || '');
                case 'price-asc':
                    return (Number(a.unitPrice) || 0) - (Number(b.unitPrice) || 0);
                case 'price-desc':
                    return (Number(b.unitPrice) || 0) - (Number(a.unitPrice) || 0);
                case 'sku-asc':
                    return (a.sku || '').localeCompare(b.sku || '');
                case 'sku-desc':
                    return (b.sku || '').localeCompare(a.sku || '');
                case 'stock-desc':
                    return (Number(b.inventory?.available) || 0) - (Number(a.inventory?.available) || 0);
                case 'stock-asc':
                    return (Number(a.inventory?.available) || 0) - (Number(b.inventory?.available) || 0);
                default:
                    return 0;
            }
        });

        return result;
    }, [productsDraft, productsSearchTerm, categoryFilter, sortBy]);

    const addProduct = () => {
        setProductsHasUnsavedChanges(true);
        setProductsDraft(prev => [...prev, toEditableProduct()]);
    };

    const updateProduct = (tempId, field, value) => {
        setProductsHasUnsavedChanges(true);
        setProductsDraft(prev => prev.map(item => {
            if (item.tempId !== tempId) return item;
            if (field.startsWith('inventory.')) {
                const inventoryField = field.split('.')[1];
                return {
                    ...item,
                    inventory: {
                        ...item.inventory,
                        [inventoryField]: inventoryField === 'tracked' ? Boolean(value) : value,
                    }
                };
            }
            if (field.startsWith('marketplaces.')) {
                const [, marketplace] = field.split('.');
                return {
                    ...item,
                    marketplaces: {
                        ...item.marketplaces,
                        [marketplace]: {
                            ...item.marketplaces[marketplace],
                            enabled: Boolean(
                                typeof value === 'object' && value !== null && 'enabled' in value
                                    ? value.enabled
                                    : value
                            ),
                        }
                    }
                };
            }
            if (field.startsWith('marketplaces') && !field.includes('.enabled')) {
                const [, marketplace] = field.split('.');
                return {
                    ...item,
                    marketplaces: {
                        ...item.marketplaces,
                        [marketplace]: {
                            ...item.marketplaces[marketplace],
                            enabled: Boolean(value),
                        }
                    }
                };
            }
            if (field === 'sku') {
                return { ...item, sku: String(value || '').trim().toUpperCase() };
            }
            return { ...item, [field]: value };
        }));
    };

    const removeProduct = (tempId) => {
        setProductsHasUnsavedChanges(true);
        setProductsDraft(prev => {
            const target = prev.find(item => item.tempId === tempId);
            if (target?.id) {
                setProductsRemovedIds(current => Array.from(new Set([...current, target.id])));
            }
            return prev.filter(item => item.tempId !== tempId);
        });
        setSelectedProducts(prev => prev.filter(id => id !== tempId));
    };

    const saveProducts = async () => {
        if (!user?.orgId) {
            setProductMessage({ type: 'error', message: 'Not authenticated. Please log in.' });
            return;
        }

        const errors = [];
        const seenSkus = new Set();

        productsDraft.forEach((product, index) => {
            const sku = String(product.sku || '').trim().toUpperCase();
            const name = String(product.name || '').trim();
            const price = Number(product.unitPrice);
            const hasBoxQuantity = product.boxQuantity !== '' && product.boxQuantity !== null && product.boxQuantity !== undefined;
            const boxQuantityValue = hasBoxQuantity ? Number(product.boxQuantity) : null;

            if (!sku) {
                errors.push(`Product ${index + 1}: SKU is required`);
            } else if (seenSkus.has(sku)) {
                errors.push(`Product ${index + 1}: Duplicate SKU "${sku}"`);
            } else {
                seenSkus.add(sku);
            }

            if (!name) {
                errors.push(`Product ${index + 1} (${sku || 'unnamed'}): Product name is required`);
            }

            if (!price || price <= 0) {
                errors.push(`Product ${index + 1} (${sku || 'unnamed'}): Unit price must be greater than 0`);
            }

            if (hasBoxQuantity && (!Number.isFinite(boxQuantityValue) || boxQuantityValue <= 0)) {
                errors.push(`Product ${index + 1} (${sku || 'unnamed'}): Box quantity must be greater than 0 when provided`);
            }
        });

        if (errors.length > 0) {
            setProductMessage({
                type: 'error',
                message: 'Please fix the following errors:\n' + errors.join('\n'),
            });
            return;
        }

        try {
            setProductMessage(null);
            const operations = [];

            productsDraft.forEach(product => {
                const hasBoxQuantity = product.boxQuantity !== '' && product.boxQuantity !== null && product.boxQuantity !== undefined;
                const boxQuantityValue = hasBoxQuantity ? Number(product.boxQuantity) : null;
                const payload = {
                    orgId: user.orgId,
                    type: 'product',
                    sku: String(product.sku || '').trim().toUpperCase(),
                    name: String(product.name || '').trim(),
                    description: String(product.description || '').trim(),
                    category: String(product.category || '').trim(),
                    unitPrice: Number(product.unitPrice) || 0,
                    taxRate: Number(product.taxRate) || 0,
                    defaultQuantity: Number(product.defaultQuantity) || 1,
                    boxQuantity: Number.isFinite(boxQuantityValue) && boxQuantityValue > 0 ? boxQuantityValue : null,
                    imageUrl: product.imageUrl || '',
                    imagePath: product.imagePath || '',
                    thumbnailUrl: product.thumbnailUrl || '',
                    inventory: {
                        tracked: Boolean(product.inventory?.tracked),
                        totalQuantity: Number(product.inventory?.totalQuantity) || 0,
                        allocated: Number(product.inventory?.allocated) || 0,
                        available: Number(product.inventory?.available) || 0,
                    },
                    marketplaces: {
                        amazon: { enabled: Boolean(product.marketplaces?.amazon?.enabled) },
                        ebay: { enabled: Boolean(product.marketplaces?.ebay?.enabled) },
                        shopify: { enabled: Boolean(product.marketplaces?.shopify?.enabled) },
                        etsy: { enabled: Boolean(product.marketplaces?.etsy?.enabled) },
                    },
                    updatedAt: serverTimestamp(),
                };

                if (product.id) {
                    operations.push(updateDoc(doc(db, 'products', product.id), payload));
                } else {
                    operations.push(addDoc(collection(db, 'products'), { ...payload, createdAt: serverTimestamp() }));
                }
            });

            productsRemovedIds.forEach(productId => {
                operations.push(deleteDoc(doc(db, 'products', productId)));
            });

            if (operations.length) {
                await Promise.all(operations);
            }

            setProductMessage({ type: 'success', message: `${productsDraft.length} product(s) saved successfully.` });
            setProductsHasUnsavedChanges(false);
            setProductsRemovedIds([]);
            setSelectedProducts([]);
        } catch (error) {
            console.error('Save products error:', error);
            setProductMessage({
                type: 'error',
                message: `Failed to save products: ${error.message || 'Unknown error'}. Check console for details.`,
            });
        }
    };

    const handleSelectProduct = (productId) => {
        setSelectedProducts(prev => {
            if (prev.includes(productId)) {
                return prev.filter(id => id !== productId);
            }
            return [...prev, productId];
        });
    };

    const handleSelectAll = (checked) => {
        if (checked) {
            setSelectedProducts(filteredAndSortedProducts.map(product => product.tempId));
        } else {
            setSelectedProducts([]);
        }
    };

    const productPriceBookCount = useMemo(() => productPriceBooks.length, [productPriceBooks]);
    const pricingTypes = ['fixed', 'hourly', 'daily'];
    const getUnitPriceLabel = (pricingType) => {
        switch (pricingType) {
            case 'hourly':
                return 'Rate per Hour';
            case 'daily':
                return 'Rate per Day';
            default:
                return 'Project Price';
        }
    };

    const renderProductsTab = () => {
        const hasActiveFilters = Boolean(productsSearchTerm.trim() || categoryFilter);
        const productSummarySuffix = categoryFilter ? ` in ${categoryFilter}` : '';
        const quickLookupLimit = 50;
        const quickLookupItems = filteredAndSortedProducts.slice(0, quickLookupLimit);
        const hasMoreQuickLookupResults = filteredAndSortedProducts.length > quickLookupLimit;

        return (
            <Card className="space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-lg text-red-400">Product Catalogue</h3>
                        <p className="text-sm text-gray-400">
                            {filteredAndSortedProducts.length} product
                            {filteredAndSortedProducts.length === 1 ? '' : 's'}
                            {productSummarySuffix}
                        </p>
                        <p className="text-xs text-gray-500">
                            Linked price books: {productPriceBookCount}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            className="w-auto"
                            ref={node => { addButtonRefs.current.products = node; }}
                            onClick={addProduct}
                        >
                            Add Product
                        </Button>
                        <Button
                            type="button"
                            className="w-auto bg-gray-800"
                            disabled={!productsHasUnsavedChanges && productsRemovedIds.length === 0}
                            onClick={saveProducts}
                        >
                            Save Changes
                        </Button>
                    </div>
                </div>

                <FilterBar
                    searchTerm={productsSearchTerm}
                    onSearchChange={setProductsSearchTerm}
                    categoryFilter={categoryFilter}
                    onCategoryChange={setCategoryFilter}
                    sortBy={sortBy}
                    onSortChange={setSortBy}
                    categories={categories}
                />

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex overflow-hidden rounded border border-red-900/50">
                        <button
                            type="button"
                            className={`px-4 py-2 text-sm font-medium transition-colors ${
                                productsView === 'list'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                            }`}
                            onClick={() => setProductsView('list')}
                        >
                            📋 List
                        </button>
                        <button
                            type="button"
                            className={`px-4 py-2 text-sm font-medium transition-colors ${
                                productsView === 'gallery'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                            }`}
                            onClick={() => setProductsView('gallery')}
                        >
                            🖼️ Gallery
                        </button>
                        <button
                            type="button"
                            className={`px-4 py-2 text-sm font-medium transition-colors ${
                                productsView === 'table'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                            }`}
                            onClick={() => setProductsView('table')}
                        >
                            📝 Detail
                        </button>
                    </div>
                    {selectedProducts.length > 0 && (
                        <div className="text-sm text-gray-400">
                            {selectedProducts.length} selected
                        </div>
                    )}
                </div>

                {productsHasUnsavedChanges && (
                    <p className="text-xs text-yellow-300">Unsaved product changes detected.</p>
                )}

                <div className="rounded border border-red-900/50 bg-gray-900/40 p-3">
                    <p className="text-xs text-gray-400">
                        <span className="text-red-400">*</span> Required fields: SKU, Product Name, Unit Price
                    </p>
                </div>

                {productsView === 'list' ? (
                    <ListView
                        products={filteredAndSortedProducts}
                        onUpdateProduct={updateProduct}
                        onRemoveProduct={removeProduct}
                        selectedProducts={selectedProducts}
                        onSelectProduct={handleSelectProduct}
                        onSelectAll={handleSelectAll}
                    />
                ) : productsView === 'gallery' ? (
                    <ProductGallery
                        products={filteredAndSortedProducts}
                        onUpdateProduct={updateProduct}
                        onRemoveProduct={removeProduct}
                        orgId={user?.orgId}
                    />
                ) : (
                    <div className="space-y-3">
                        {filteredAndSortedProducts.length === 0 ? (
                            <div className="rounded border border-red-900/40 bg-gray-900/40 px-4 py-6 text-center text-sm text-gray-500">
                                {productsDraft.length === 0 && !hasActiveFilters
                                    ? 'Add products to build your catalogue'
                                    : 'No products match your filters'}
                            </div>
                        ) : (
                            filteredAndSortedProducts.map(product => (
                                <div key={product.tempId} className="space-y-4 border border-red-900 bg-gray-900/60 p-4">
                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                                        <div className="md:col-span-2">
                                            <label className="mb-1 block text-xs font-medium text-red-300">SKU *</label>
                                            <Input
                                                value={product.sku}
                                                onChange={event => updateProduct(product.tempId, 'sku', event.target.value)}
                                                placeholder="PROD-001"
                                            />
                                        </div>
                                        <div className="md:col-span-3">
                                            <label className="mb-1 block text-xs font-medium text-red-300">Product Name *</label>
                                            <Input
                                                value={product.name}
                                                onChange={event => updateProduct(product.tempId, 'name', event.target.value)}
                                                placeholder="Widget Pro"
                                            />
                                        </div>
                                        <div className="md:col-span-3">
                                            <label className="mb-1 block text-xs font-medium text-red-300">Description</label>
                                            <Input
                                                value={product.description}
                                                onChange={event => updateProduct(product.tempId, 'description', event.target.value)}
                                                placeholder="Product description"
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="mb-1 block text-xs font-medium text-red-300">Category</label>
                                            <Input
                                                value={product.category}
                                                onChange={event => updateProduct(product.tempId, 'category', event.target.value)}
                                                placeholder="Hardware"
                                            />
                                        </div>
                                        <div className="md:col-span-1">
                                            <label className="mb-1 block text-xs font-medium text-red-300">Unit Price *</label>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                value={product.unitPrice}
                                                onChange={event => updateProduct(product.tempId, 'unitPrice', event.target.value)}
                                                placeholder="0.00"
                                            />
                                        </div>
                                        <div className="md:col-span-1">
                                            <label className="mb-1 block text-xs font-medium text-red-300">Tax %</label>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                value={product.taxRate}
                                                onChange={event => updateProduct(product.tempId, 'taxRate', event.target.value)}
                                                placeholder="20"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                                        <div className="md:col-span-2">
                                            <label className="mb-1 block text-xs font-medium text-red-300">Default Quantity</label>
                                            <Input
                                                type="number"
                                                value={product.defaultQuantity}
                                                onChange={event => updateProduct(product.tempId, 'defaultQuantity', event.target.value)}
                                                placeholder="1"
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="mb-1 block text-xs font-medium text-red-300">Box Quantity (optional)</label>
                                            <Input
                                                type="number"
                                                value={product.boxQuantity ?? ''}
                                                onChange={event => updateProduct(product.tempId, 'boxQuantity', event.target.value)}
                                                placeholder="e.g. 12"
                                            />
                                            <span className="text-xs text-gray-500">Units packaged together</span>
                                        </div>
                                    </div>

                                    <div className="border-t border-red-900/50 pt-3">
                                        <div className="mb-3 flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(product.inventory?.tracked)}
                                                onChange={event => updateProduct(product.tempId, 'inventory.tracked', event.target.checked)}
                                                className="h-4 w-4 accent-red-500"
                                            />
                                            <label className="text-sm font-medium text-red-300">Track Inventory</label>
                                        </div>
                                        {product.inventory?.tracked && (
                                            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-gray-400">Total Stock</label>
                                                    <Input
                                                        type="number"
                                                        value={product.inventory?.totalQuantity}
                                                        onChange={event => updateProduct(product.tempId, 'inventory.totalQuantity', event.target.value)}
                                                        placeholder="0"
                                                    />
                                                    <span className="text-xs text-gray-500">Units in warehouse</span>
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-gray-400">Allocated</label>
                                                    <Input
                                                        type="number"
                                                        value={product.inventory?.allocated}
                                                        onChange={event => updateProduct(product.tempId, 'inventory.allocated', event.target.value)}
                                                        placeholder="0"
                                                    />
                                                    <span className="text-xs text-gray-500">Assigned to marketplaces</span>
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-gray-400">Available</label>
                                                    <Input
                                                        type="number"
                                                        value={product.inventory?.available}
                                                        onChange={event => updateProduct(product.tempId, 'inventory.available', event.target.value)}
                                                        placeholder="0"
                                                    />
                                                    <span className="text-xs text-gray-500">Free for allocation</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="border-t border-red-900/50 pt-3">
                                        <label className="mb-2 block text-xs font-medium text-red-300">Publish to Marketplaces</label>
                                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                            {[
                                                { id: 'amazon', label: 'Amazon' },
                                                { id: 'ebay', label: 'eBay' },
                                                { id: 'shopify', label: 'Shopify' },
                                                { id: 'etsy', label: 'Etsy' },
                                            ].map(market => (
                                                <label key={market.id} className="flex cursor-pointer items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={Boolean(product.marketplaces?.[market.id]?.enabled)}
                                                        onChange={event => updateProduct(product.tempId, `marketplaces.${market.id}`, event.target.checked)}
                                                        className="h-4 w-4 accent-red-500"
                                                    />
                                                    <span className="text-sm text-gray-300">{market.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex justify-end border-t border-red-900/50 pt-3">
                                        <Button
                                            type="button"
                                            className="w-auto bg-gray-800"
                                            onClick={() => removeProduct(product.tempId)}
                                        >
                                            Remove Product
                                        </Button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                <div className="space-y-2 rounded border border-red-900 bg-gray-900/60 p-4">
                    <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                        <h4 className="text-sm font-semibold text-red-200">Quick SKU lookup</h4>
                        <span className="text-xs text-gray-400">
                            {filteredAndSortedProducts.length} match{filteredAndSortedProducts.length === 1 ? '' : 'es'}
                            {hasActiveFilters ? '' : ' · showing latest catalogue'}
                        </span>
                    </div>
                    <p className="text-xs text-gray-500">
                        Use the filters and search above to narrow down by product name, description, or category. This lightweight list stays visible even when switching catalogue layouts.
                    </p>
                    <div className="max-h-56 overflow-y-auto rounded border border-red-900/60">
                        {quickLookupItems.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-gray-500">
                                No products to show. {hasActiveFilters ? 'Try clearing your filters.' : 'Add products to populate the lookup.'}
                            </div>
                        ) : (
                            quickLookupItems.map(product => (
                                <div
                                    key={product.tempId}
                                    className="grid grid-cols-1 gap-2 border-b border-red-900/40 px-3 py-2 last:border-b-0 md:grid-cols-5 md:items-center"
                                >
                                    <div className="md:col-span-3 text-sm text-gray-100">
                                        {product.name || 'Unnamed product'}
                                        {product.description && (
                                            <span className="block text-xs text-gray-500">
                                                {product.description}
                                            </span>
                                        )}
                                    </div>
                                    <div className="md:col-span-2 font-mono text-sm text-red-200 md:text-right">
                                        {product.sku || 'No SKU'}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    {hasMoreQuickLookupResults && (
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">
                            Showing first {quickLookupLimit} results. Refine your search to narrow further.
                        </p>
                    )}
                </div>

                {productMessage && (
                    <div
                        role="alert"
                        className={'rounded border-l-4 px-4 py-3 text-sm whitespace-pre-line ' + (
                            productMessage.type === 'success'
                                ? 'border-green-500 bg-green-900/20 text-green-200'
                                : 'border-yellow-500 bg-yellow-900/30 text-yellow-200'
                        )}
                    >
                        {productMessage.message}
                    </div>
                )}
            </Card>
        );
    };

    const addService = () => {
        setServicesHasUnsavedChanges(true);
        setServicesDraft(prev => [...prev, toEditableService()]);
    };

    const updateService = (tempId, field, value) => {
        setServicesHasUnsavedChanges(true);
        setServicesDraft(prev => prev.map(item => {
            if (item.tempId !== tempId) return item;
            const next = { ...item };
            if (field === 'sku') {
                next.sku = String(value || '').trim().toUpperCase();
                return next;
            }
            if (field === 'pricingType') {
                const normalized = String(value || '').trim().toLowerCase();
                next.pricingType = pricingTypes.includes(normalized) ? normalized : 'fixed';
                if (next.pricingType === 'fixed') {
                    next.estimatedDuration = '';
                }
                return next;
            }
            if (field === 'unitPrice' || field === 'taxRate' || field === 'defaultQuantity') {
                next[field] = value;
                return next;
            }
            if (field === 'estimatedDuration') {
                next.estimatedDuration = value;
                return next;
            }
            next[field] = value;
            return next;
        }));
    };

    const removeService = (tempId) => {
        setServicesHasUnsavedChanges(true);
        setServicesDraft(prev => {
            const target = prev.find(item => item.tempId === tempId);
            if (target?.id) {
                setServicesRemovedIds(current => Array.from(new Set([...current, target.id])));
            }
            return prev.filter(item => item.tempId !== tempId);
        });
    };

    const saveServices = async () => {
        if (!user?.orgId) {
            setServiceMessage({ type: 'error', message: 'Not authenticated. Please log in.' });
            return;
        }

        const errors = [];
        const seenSkus = new Set();

        servicesDraft.forEach((service, index) => {
            const sku = String(service.sku || '').trim().toUpperCase();
            const name = String(service.name || '').trim();
            const pricingType = String(service.pricingType || '').trim().toLowerCase();
            const unitPrice = Number(service.unitPrice);

            if (!sku) {
                errors.push(`Service ${index + 1}: SKU is required.`);
            } else if (seenSkus.has(sku)) {
                errors.push(`Service ${index + 1}: Duplicate SKU "${sku}".`);
            } else {
                seenSkus.add(sku);
            }

            if (!name) {
                errors.push(`Service ${index + 1} (${sku || 'unnamed'}): Name is required.`);
            }

            if (!pricingType || !pricingTypes.includes(pricingType)) {
                errors.push(`Service ${index + 1} (${sku || 'unnamed'}): Pricing type must be fixed, hourly, or daily.`);
            }

            if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
                errors.push(`Service ${index + 1} (${sku || 'unnamed'}): Unit price must be greater than 0.`);
            }
        });

        if (errors.length) {
            setServiceMessage({
                type: 'error',
                message: 'Please resolve the following issues:\n' + errors.join('\n'),
            });
            return;
        }

        try {
            setServiceMessage(null);
            const operations = [];

            servicesDraft.forEach(service => {
                const pricingType = pricingTypes.includes(String(service.pricingType).toLowerCase())
                    ? String(service.pricingType).toLowerCase()
                    : 'fixed';
                const payload = {
                    orgId: user.orgId,
                    type: 'service',
                    sku: String(service.sku || '').trim().toUpperCase(),
                    name: String(service.name || '').trim(),
                    description: String(service.description || '').trim(),
                    category: String(service.category || '').trim(),
                    pricingType,
                    unitPrice: Number(service.unitPrice) || 0,
                    taxRate: Number(service.taxRate) || 0,
                    defaultQuantity: Number(service.defaultQuantity) || 1,
                    estimatedDuration: pricingType === 'hourly' || pricingType === 'daily'
                        ? String(service.estimatedDuration || '').trim()
                        : '',
                    updatedAt: serverTimestamp(),
                };

                if (service.id) {
                    operations.push(updateDoc(doc(db, 'services', service.id), payload));
                } else {
                    operations.push(addDoc(collection(db, 'services'), { ...payload, createdAt: serverTimestamp() }));
                }
            });

            servicesRemovedIds.forEach(serviceId => {
                operations.push(deleteDoc(doc(db, 'services', serviceId)));
            });

            if (operations.length) {
                await Promise.all(operations);
            }

            setServiceMessage({ type: 'success', message: `${servicesDraft.length} service(s) saved successfully.` });
            setServicesHasUnsavedChanges(false);
            setServicesRemovedIds([]);
        } catch (error) {
            console.error('Save services error:', error);
            setServiceMessage({
                type: 'error',
                message: `Failed to save services: ${error?.message || 'Unknown error'}. Check console for details.`,
            });
        }
    };

    const renderServicesTab = () => (
        <Card className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <h3 className="text-lg text-red-400">Service Catalogue</h3>
                    <p className="text-sm text-gray-400">Describe the services and engagements your team delivers.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        className="w-auto"
                        ref={node => { addButtonRefs.current.services = node; }}
                        onClick={addService}
                    >
                        Add Service
                    </Button>
                    <Button
                        type="button"
                        className="w-auto bg-gray-800"
                        disabled={!servicesHasUnsavedChanges}
                        onClick={saveServices}
                    >
                        Save Changes
                    </Button>
                </div>
            </div>
            {servicesDraft.length === 0 ? (
                <div className="rounded border border-red-900/40 bg-gray-900/40 px-4 py-6 text-center text-sm text-gray-500">
                    Add services to build your catalogue
                </div>
            ) : (
                <div className="space-y-4">
                    {servicesDraft.map(service => {
                        const showDuration = service.pricingType === 'hourly' || service.pricingType === 'daily';
                        return (
                            <div key={service.tempId} className="space-y-4 border border-red-900 bg-gray-900/60 p-4">
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                                    <div>
                                        <label className="mb-1 block text-xs uppercase tracking-wide text-red-300">SKU</label>
                                        <Input
                                            value={service.sku}
                                            onChange={event => updateService(service.tempId, 'sku', event.target.value)}
                                            placeholder="SRV-001"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs uppercase tracking-wide text-red-300">Name</label>
                                        <Input
                                            value={service.name}
                                            onChange={event => updateService(service.tempId, 'name', event.target.value)}
                                            placeholder="Discovery Workshop"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs uppercase tracking-wide text-red-300">Category</label>
                                        <Input
                                            value={service.category}
                                            onChange={event => updateService(service.tempId, 'category', event.target.value)}
                                            placeholder="Consulting"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs uppercase tracking-wide text-red-300">Pricing Type</label>
                                        <Select
                                            value={service.pricingType}
                                            onChange={event => updateService(service.tempId, 'pricingType', event.target.value)}
                                        >
                                            {pricingTypes.map(type => (
                                                <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                                            ))}
                                        </Select>
                                    </div>
                                </div>

                                <div>
                                    <label className="mb-1 block text-xs uppercase tracking-wide text-red-300">Description</label>
                                    <TextArea
                                        rows={3}
                                        value={service.description}
                                        onChange={event => updateService(service.tempId, 'description', event.target.value)}
                                        placeholder="Outline the scope, deliverables, and expectations for this service."
                                    />
                                </div>

                                <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                                    <div>
                                        <label className="mb-1 block text-xs uppercase tracking-wide text-red-300">{getUnitPriceLabel(service.pricingType)}</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={service.unitPrice}
                                            onChange={event => updateService(service.tempId, 'unitPrice', event.target.value)}
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs uppercase tracking-wide text-red-300">Tax Rate %</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={service.taxRate}
                                            onChange={event => updateService(service.tempId, 'taxRate', event.target.value)}
                                            placeholder="20"
                                        />
                                    </div>
                                    {showDuration && (
                                        <div>
                                            <label className="mb-1 block text-xs uppercase tracking-wide text-red-300">Est. Duration</label>
                                            <Input
                                                value={service.estimatedDuration}
                                                onChange={event => updateService(service.tempId, 'estimatedDuration', event.target.value)}
                                                placeholder={service.pricingType === 'hourly' ? 'e.g. 6 hours' : 'e.g. 3 days'}
                                            />
                                        </div>
                                    )}
                                    <div className={`md:col-span-1 ${showDuration ? '' : 'md:col-start-3'}`}>
                                        <label className="mb-1 block text-xs uppercase tracking-wide text-red-300">Default Qty</label>
                                        <Input
                                            type="number"
                                            value={service.defaultQuantity}
                                            onChange={event => updateService(service.tempId, 'defaultQuantity', event.target.value)}
                                            placeholder="1"
                                        />
                                    </div>
                                    <div className="md:col-span-1 flex items-end justify-end">
                                        <Button
                                            type="button"
                                            className="w-auto bg-gray-800"
                                            onClick={() => removeService(service.tempId)}
                                        >
                                            Remove
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            {serviceMessage && (
                <div
                    role="status"
                    className={`rounded border-l-4 px-3 py-2 text-sm whitespace-pre-line ${
                        serviceMessage.type === 'success'
                            ? 'border-green-500 bg-green-900/20 text-green-200'
                            : 'border-yellow-500 bg-yellow-900/30 text-yellow-200'
                    }`}
                >
                    {serviceMessage.message}
                </div>
            )}
        </Card>
    );

    const renderMarketplaceTab = () => (
        <Card className="space-y-4">
            <h3 className="text-lg text-red-400">Marketplace</h3>
            <p className="rounded border border-red-900/40 bg-gray-900/40 px-4 py-6 text-sm text-gray-300">
                Marketplace integration coming soon
            </p>
        </Card>
    );

    return (
        <div className="space-y-6">
            <Card className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                        <h2 className="text-xl font-semibold text-red-300">Catalogue Console</h2>
                        <p className="text-sm text-gray-400">
                            Curate products, services, and prepare for future marketplace integrations.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {tabs.map(tab => (
                            <Button
                                key={tab.id}
                                type="button"
                                className={`w-auto ${activeTab === tab.id ? '' : 'bg-gray-800 hover:bg-gray-700'}`}
                                onClick={() => setActiveTab(tab.id)}
                                aria-pressed={activeTab === tab.id}
                            >
                                {tab.label}
                            </Button>
                        ))}
                    </div>
                </div>
                {!user?.orgId && (
                    <p className="text-xs uppercase tracking-wide text-yellow-300">
                        Connect to an organisation to unlock catalogue publishing.
                    </p>
                )}
            </Card>

            {activeTab === 'products' && renderProductsTab()}
            {activeTab === 'services' && renderServicesTab()}
            {activeTab === 'marketplace' && renderMarketplaceTab()}
        </div>
    );
};

export default CatalogueConsole;
