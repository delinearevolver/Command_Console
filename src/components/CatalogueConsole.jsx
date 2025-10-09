import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, useAuth, useData } from '../App';
import { Card, Input, Button, Select, TextArea } from './ui';

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

const CatalogueConsole = () => {
    const { user } = useAuth();
    const { products = [], productPriceBooks = [] } = useData();
    const [activeTab, setActiveTab] = useState('products');
    const [productsDraft, setProductsDraft] = useState([]);
    const [servicesDraft, setServicesDraft] = useState([]);
    const [productsHasUnsavedChanges, setProductsHasUnsavedChanges] = useState(false);
    const [servicesHasUnsavedChanges, setServicesHasUnsavedChanges] = useState(false);
    const [productMessage, setProductMessage] = useState(null);
    const [serviceMessage, setServiceMessage] = useState(null);
    const [productsRemovedIds, setProductsRemovedIds] = useState([]);

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
        }
    }, [products, productsHasUnsavedChanges]);

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
        } catch (error) {
            console.error('Save products error:', error);
            setProductMessage({
                type: 'error',
                message: `Failed to save products: ${error.message || 'Unknown error'}. Check console for details.`,
            });
        }
    };

    const productPriceBookCount = useMemo(() => productPriceBooks.length, [productPriceBooks]);

    const renderProductsTab = () => (
        <Card className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <h3 className="text-lg text-red-400">Product Catalogue</h3>
                    <p className="text-sm text-gray-400">Curate the physical or digital products you offer.</p>
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
            {productsHasUnsavedChanges && (
                <p className="text-xs text-yellow-300">Unsaved product changes detected.</p>
            )}
            <div className="bg-gray-900/40 border border-red-900/50 rounded p-3 mb-4">
                <p className="text-xs text-gray-400">
                    <span className="text-red-400">*</span> Required fields: SKU, Product Name, Unit Price
                </p>
            </div>
            <div className="space-y-3">
                {productsDraft.length === 0 && (
                    <div className="rounded border border-red-900/40 bg-gray-900/40 px-4 py-6 text-center text-sm text-gray-500">
                        Add products to build your catalogue
                    </div>
                )}
                {productsDraft.map(product => (
                    <div key={product.tempId} className="space-y-4 border border-red-900 bg-gray-900/60 p-4">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                            <div className="md:col-span-2">
                                <label className="block text-xs font-medium text-red-300 mb-1">SKU *</label>
                                <Input
                                    value={product.sku}
                                    onChange={event => updateProduct(product.tempId, 'sku', event.target.value)}
                                    placeholder="PROD-001"
                                />
                            </div>
                            <div className="md:col-span-3">
                                <label className="block text-xs font-medium text-red-300 mb-1">Product Name *</label>
                                <Input
                                    value={product.name}
                                    onChange={event => updateProduct(product.tempId, 'name', event.target.value)}
                                    placeholder="Widget Pro"
                                />
                            </div>
                            <div className="md:col-span-3">
                                <label className="block text-xs font-medium text-red-300 mb-1">Description</label>
                                <Input
                                    value={product.description}
                                    onChange={event => updateProduct(product.tempId, 'description', event.target.value)}
                                    placeholder="Product description"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-xs font-medium text-red-300 mb-1">Category</label>
                                <Input
                                    value={product.category}
                                    onChange={event => updateProduct(product.tempId, 'category', event.target.value)}
                                    placeholder="Hardware"
                                />
                            </div>
                            <div className="md:col-span-1">
                                <label className="block text-xs font-medium text-red-300 mb-1">Unit Price *</label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    value={product.unitPrice}
                                    onChange={event => updateProduct(product.tempId, 'unitPrice', event.target.value)}
                                    placeholder="0.00"
                                />
                            </div>
                            <div className="md:col-span-1">
                                <label className="block text-xs font-medium text-red-300 mb-1">Tax %</label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    value={product.taxRate}
                                    onChange={event => updateProduct(product.tempId, 'taxRate', event.target.value)}
                                    placeholder="20"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                            <div className="md:col-span-2">
                                <label className="block text-xs font-medium text-red-300 mb-1">Default Quantity</label>
                                <Input
                                    type="number"
                                    value={product.defaultQuantity}
                                    onChange={event => updateProduct(product.tempId, 'defaultQuantity', event.target.value)}
                                    placeholder="1"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-xs font-medium text-red-300 mb-1">Box Quantity (optional)</label>
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
                            <div className="flex items-center gap-2 mb-3">
                                <input
                                    type="checkbox"
                                    checked={Boolean(product.inventory?.tracked)}
                                    onChange={event => updateProduct(product.tempId, 'inventory.tracked', event.target.checked)}
                                    className="w-4 h-4 accent-red-500"
                                />
                                <label className="text-sm font-medium text-red-300">Track Inventory</label>
                            </div>
                            {product.inventory?.tracked && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-400 mb-1">Total Stock</label>
                                        <Input
                                            type="number"
                                            value={product.inventory?.totalQuantity}
                                            onChange={event => updateProduct(product.tempId, 'inventory.totalQuantity', event.target.value)}
                                            placeholder="0"
                                        />
                                        <span className="text-xs text-gray-500">Units in warehouse</span>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-400 mb-1">Allocated</label>
                                        <Input
                                            type="number"
                                            value={product.inventory?.allocated}
                                            onChange={event => updateProduct(product.tempId, 'inventory.allocated', event.target.value)}
                                            placeholder="0"
                                        />
                                        <span className="text-xs text-gray-500">Assigned to marketplaces</span>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-400 mb-1">Available</label>
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
                            <label className="block text-xs font-medium text-red-300 mb-2">Publish to Marketplaces</label>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {[
                                    { id: 'amazon', label: 'Amazon' },
                                    { id: 'ebay', label: 'eBay' },
                                    { id: 'shopify', label: 'Shopify' },
                                    { id: 'etsy', label: 'Etsy' },
                                ].map(market => (
                                    <label key={market.id} className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(product.marketplaces?.[market.id]?.enabled)}
                                            onChange={event => updateProduct(product.tempId, `marketplaces.${market.id}`, event.target.checked)}
                                            className="w-4 h-4 accent-red-500"
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
                ))}
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
                        onClick={() => {
                            setServicesHasUnsavedChanges(true);
                            setServicesDraft(prev => prev.slice());
                        }}
                    >
                        Add Service
                    </Button>
                    <Button
                        type="button"
                        className="w-auto bg-gray-800"
                        disabled={!servicesHasUnsavedChanges}
                        onClick={() => {
                            setServiceMessage({ type: 'success', message: 'Service catalogue changes saved.' });
                            setServicesHasUnsavedChanges(false);
                        }}
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
                <div className="rounded border border-red-900/40 bg-gray-900/40 px-4 py-6 text-sm text-gray-300">
                    Services will appear here
                </div>
            )}
            {serviceMessage && (
                <div
                    role="status"
                    className={`rounded border-l-4 px-3 py-2 text-sm ${
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
