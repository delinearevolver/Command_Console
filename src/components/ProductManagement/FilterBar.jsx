import React from 'react';
import { Input, Select } from '../ui';

const FilterBar = ({
    searchTerm,
    onSearchChange,
    categoryFilter,
    onCategoryChange,
    sortBy,
    onSortChange,
    categories,
}) => (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
            <Input
                placeholder="🔍 Search by name, SKU, description, or category..."
                value={searchTerm}
                onChange={(event) => onSearchChange(event.target.value)}
                className="w-full"
            />
        </div>
        <Select
            value={categoryFilter}
            onChange={(event) => onCategoryChange(event.target.value)}
            className="sm:w-48"
        >
            <option value="">All Categories</option>
            {categories.map((category) => (
                <option key={category} value={category}>
                    {category}
                </option>
            ))}
        </Select>
        <Select
            value={sortBy}
            onChange={(event) => onSortChange(event.target.value)}
            className="sm:w-48"
        >
            <option value="name-asc">Name (A-Z)</option>
            <option value="name-desc">Name (Z-A)</option>
            <option value="price-asc">Price (Low-High)</option>
            <option value="price-desc">Price (High-Low)</option>
            <option value="sku-asc">SKU (A-Z)</option>
            <option value="sku-desc">SKU (Z-A)</option>
            <option value="stock-desc">Stock (High-Low)</option>
            <option value="stock-asc">Stock (Low-High)</option>
        </Select>
    </div>
);

export default FilterBar;
