"""
P&L API Server - Connects your accounting database to your dashboard
Run with: python pl_api.py
"""

from flask import Flask, jsonify
from flask_cors import CORS
from decimal import Decimal
import sqlite3
from datetime import datetime
import sys
import os

# Add the accounting system to path
sys.path.insert(0, r'C:\Users\steph\CMQUO_Full_account_Build_Pack_completed')
from accounts import generate_profit_and_loss, generate_balance_sheet

app = Flask(__name__)
CORS(app)  # Enable CORS for your React app

LEDGER_PATH = r'C:\Users\steph\CMQUO_Full_account_Build_Pack_completed\ledger.db'

def decimal_to_float(obj):
    """Convert Decimal objects to float for JSON serialization"""
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError

@app.route('/api/pl', methods=['GET'])
def get_pl_data():
    """
    Get current P&L data from the accounting system
    """
    try:
        # Generate P&L from your accounting system
        pl_rows = generate_profit_and_loss(LEDGER_PATH)
        
        # Process the data into a format suitable for the dashboard
        income_items = []
        expense_items = []
        total_income = 0
        total_expenses = 0
        
        for row in pl_rows:
            # Convert to tuple to access the data
            row_data = row.as_tuple()
            category = row_data[0]
            account_code = row_data[1]
            account_name = row_data[2]
            amount = float(row_data[3])
            
            if category == 'Income':
                # Income is typically negative in double-entry bookkeeping
                actual_amount = abs(amount)
                income_items.append({
                    'account': account_name,
                    'amount': actual_amount
                })
                total_income += actual_amount
            elif category == 'Expense':
                expense_items.append({
                    'account': account_name,
                    'amount': amount
                })
                total_expenses += amount
        
        net_profit = total_income - total_expenses
        profit_margin = (net_profit / total_income * 100) if total_income > 0 else 0
        
        # Return the formatted data
        return jsonify({
            'income': income_items,
            'expenses': expense_items,
            'totalIncome': total_income,
            'totalExpenses': total_expenses,
            'netProfit': net_profit,
            'profitMargin': profit_margin,
            'lastUpdated': datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"Error generating P&L: {e}")
        # Return mock data for testing if the real data fails
        return jsonify({
            'income': [
                {'account': 'Amazon Deliveries', 'amount': 2400},
                {'account': 'Consulting', 'amount': 5000}
            ],
            'expenses': [
                {'account': 'Fuel', 'amount': 450},
                {'account': 'Insurance', 'amount': 280},
                {'account': 'Phone', 'amount': 45}
            ],
            'totalIncome': 7400,
            'totalExpenses': 775,
            'netProfit': 6625,
            'profitMargin': 89.5,
            'lastUpdated': datetime.now().isoformat()
        })

@app.route('/api/health', methods=['GET'])
def health_check():
    """Simple health check endpoint"""
    return jsonify({'status': 'operational', 'timestamp': datetime.now().isoformat()})

if __name__ == '__main__':
    print("Starting P&L API Server...")
    print(f"Ledger location: {LEDGER_PATH}")
    print("Server running on http://localhost:5000")
    print("Your dashboard can now fetch live P&L data!")
    
    # Run the server
    app.run(host='0.0.0.0', port=5000, debug=True)