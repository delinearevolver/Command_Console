from pathlib import Path

text = Path('src/components/BillingConsole.jsx').read_text()
stack = []
match = {'(': ')', '{': '}', '[': ']'}
reverse = {')': '(', '}': '{', ']': '['}
for idx, ch in enumerate(text):
    if ch in match:
        stack.append((ch, idx))
    elif ch in reverse:
        if not stack:
            print('Extra closing', ch, 'at', idx)
            break
        open_ch, pos = stack.pop()
        if reverse[ch] != open_ch:
            print('Mismatch', open_ch, pos, '->', ch, idx)
            break
else:
    print('remaining openings:', len(stack))
    if stack:
        print(stack[-5:])
