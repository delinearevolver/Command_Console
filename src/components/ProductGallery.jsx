import React, { useState, useRef } from 'react';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../App';
import { Card, Input, Button } from './ui';

const VALID_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ProductGallery = ({ products, onUpdateProduct, onRemoveProduct, orgId }) => {
    const [uploading, setUploading] = useState(null);
    const [selectedProduct, setSelectedProduct] = useState(null);

    const handleImageUpload = async (file, product) => {
        if (!file || !orgId) return;
        if (!VALID_IMAGE_TYPES.includes(file.type)) {
            alert('Please upload a valid image (JPG, PNG, or WebP).');
            return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
            alert('Image must be less than 5MB.');
            return;
        }
        try {
            setUploading(product.tempId);
            const compressedFile = await compressImage(file, 800, 800);
            if (product.imagePath) {
                try {
                    const oldRef = ref(storage, product.imagePath);
                    await deleteObject(oldRef);
                } catch (error) {
                    console.warn('Previous image removal failed:', error);
                }
            }
            const filename = `${Date.now()}_${file.name}`;
            const storagePath = `catalogue-images/${orgId}/${product.tempId}/${filename}`;
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, compressedFile);
            const downloadURL = await getDownloadURL(storageRef);
            onUpdateProduct(product.tempId, 'imageUrl', downloadURL);
            onUpdateProduct(product.tempId, 'imagePath', storagePath);
        } catch (error) {
            console.error('Image upload error:', error);
            alert(`Failed to upload image: ${error.message || 'Unknown error.'}`);
        } finally {
            setUploading(null);
        }
    };

    const compressImage = (file, maxWidth, maxHeight) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = event => {
                const img = new Image();
                img.onload = () => {
                    let { width, height } = img;
                    if (width > height) {
                        if (width > maxWidth) {
                            height = Math.round((height * maxWidth) / width);
                            width = maxWidth;
                        }
                    } else if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    canvas.toBlob(blob => {
                        if (!blob) {
                            reject(new Error('Unable to process image.'));
                            return;
                        }
                        resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                    }, 'image/jpeg', 0.85);
                };
                img.onerror = reject;
                img.src = event.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const ProductCard = ({ product }) => {
        const fileInputRef = useRef(null);
        const hasImage = !!product.imageUrl;
        const isUploading = uploading === product.tempId;

        return (
            <Card className="overflow-hidden hover:shadow-lg transition-shadow">
                <div className="relative aspect-[4/3] bg-gray-900/60 border-b border-red-900/50">
                    {hasImage ? (
                        <img
                            src={product.imageUrl}
                            alt={product.name || 'Product'}
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center">
                            <svg
                                className="h-16 w-16 text-gray-600"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={1.5}
                                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                />
                            </svg>
                        </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity hover:opacity-100">
                        <Button
                            type="button"
                            className="w-auto"
                            disabled={isUploading}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            {isUploading ? 'Uploading...' : hasImage ? '📷 Change Photo' : '📷 Add Photo'}
                        </Button>
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={VALID_IMAGE_TYPES.join(',')}
                        className="hidden"
                        onChange={event => {
                            const file = event.target.files?.[0];
                            if (file) handleImageUpload(file, product);
                            event.target.value = '';
                        }}
                    />
                </div>
                <div className="space-y-2 p-4">
                    <h4 className="truncate font-semibold text-red-300" title={product.name}>
                        {product.name || 'Unnamed Product'}
                    </h4>
                    {(product.category || product.description) && (
                        <div className="space-y-1 text-sm text-gray-400">
                            {product.category && (
                                <div className="font-medium text-gray-300">
                                    📦 {product.category}
                                </div>
                            )}
                            {product.description && (
                                <p className="text-xs text-gray-400">
                                    {product.description}
                                </p>
                            )}
                        </div>
                    )}
                    <div className="flex items-baseline justify-between">
                        <span className="text-2xl font-bold text-green-400">
                            £{Number(product.unitPrice || 0).toFixed(2)}
                        </span>
                        <span className="text-xs text-gray-500">
                            SKU: {product.sku || 'N/A'}
                        </span>
                    </div>
                    {product.inventory?.tracked && (
                        <div className="text-xs text-gray-400">
                            📊 Stock: {product.inventory?.available || 0} available
                        </div>
                    )}
                    <div className="flex flex-wrap gap-1 pt-2">
                        {product.marketplaces?.amazon?.enabled && (
                            <span className="rounded bg-yellow-900/30 px-2 py-0.5 text-xs text-yellow-300">
                                Amazon
                            </span>
                        )}
                        {product.marketplaces?.ebay?.enabled && (
                            <span className="rounded bg-blue-900/30 px-2 py-0.5 text-xs text-blue-300">
                                eBay
                            </span>
                        )}
                        {product.marketplaces?.shopify?.enabled && (
                            <span className="rounded bg-green-900/30 px-2 py-0.5 text-xs text-green-300">
                                Shopify
                            </span>
                        )}
                        {product.marketplaces?.etsy?.enabled && (
                            <span className="rounded bg-orange-900/30 px-2 py-0.5 text-xs text-orange-300">
                                Etsy
                            </span>
                        )}
                    </div>
                    <div className="flex gap-2 border-t border-red-900/30 pt-2">
                        <Button
                            type="button"
                            className="w-full bg-gray-800 text-sm"
                            onClick={() => setSelectedProduct(product)}
                        >
                            ✏️ Edit
                        </Button>
                        <Button
                            type="button"
                            className="w-auto bg-red-900/40 text-sm"
                            onClick={() => {
                                if (window.confirm(`Remove ${product.name || 'this product'}?`)) {
                                    onRemoveProduct(product.tempId);
                                }
                            }}
                        >
                            🗑️
                        </Button>
                    </div>
                </div>
            </Card>
        );
    };

    return (
        <div className="space-y-4">
            {products.length === 0 ? (
                <div className="rounded border border-red-900/40 bg-gray-900/40 px-4 py-12 text-center text-sm text-gray-500">
                    No products found
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {products.map(product => (
                        <ProductCard key={product.tempId} product={product} />
                    ))}
                </div>
            )}

            {selectedProduct && (
                <QuickEditModal
                    product={selectedProduct}
                    onClose={() => setSelectedProduct(null)}
                    onUpdate={onUpdateProduct}
                />
            )}
        </div>
    );
};

const QuickEditModal = ({ product, onClose, onUpdate }) => {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={onClose}
        >
            <div
                className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-red-900 bg-gray-900"
                onClick={event => event.stopPropagation()}
            >
                <div className="sticky top-0 flex items-center justify-between border-b border-red-900/50 bg-gray-900 p-4">
                    <h3 className="text-lg font-semibold text-red-300">
                        Quick Edit: {product.name || 'Product'}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-2xl leading-none text-gray-400 hover:text-white"
                        type="button"
                    >
                        ×
                    </button>
                </div>
                <div className="space-y-4 p-4">
                    <div>
                        <label className="mb-1 block text-xs font-medium text-red-300">
                            Product Name *
                        </label>
                        <Input
                            value={product.name}
                            onChange={event => onUpdate(product.tempId, 'name', event.target.value)}
                        />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="mb-1 block text-xs font-medium text-red-300">
                                Unit Price *
                            </label>
                            <Input
                                type="number"
                                step="0.01"
                                value={product.unitPrice}
                                onChange={event => onUpdate(product.tempId, 'unitPrice', event.target.value)}
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-red-300">
                                Tax %
                            </label>
                            <Input
                                type="number"
                                step="0.01"
                                value={product.taxRate}
                                onChange={event => onUpdate(product.tempId, 'taxRate', event.target.value)}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-medium text-red-300">
                            Description
                        </label>
                        <Input
                            value={product.description}
                            onChange={event => onUpdate(product.tempId, 'description', event.target.value)}
                        />
                    </div>
                    <div className="flex justify-end gap-2 border-t border-red-900/50 pt-4">
                        <Button type="button" className="w-auto bg-gray-800" onClick={onClose}>
                            Done
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProductGallery;
