# Codex Notes

- This project contains Japanese text in UTF-8 JSON/CSV files.
- On Windows PowerShell 5.1, the default console code page may be Shift_JIS/932.
- When reading Japanese text files from PowerShell, use `-Encoding UTF8`, for example:
  `Get-Content templates\ai_prompt_30s.json -Raw -Encoding UTF8`.
- Do not assume mojibake in command output means the source JSON/CSV file is corrupt.
