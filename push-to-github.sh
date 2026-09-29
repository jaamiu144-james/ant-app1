#!/usr/bin/env bash
# Ant App - Push to GitHub (Mac/Linux)
set -e

echo "============================================"
echo "   Ant App - Push to GitHub"
echo "============================================"
echo

if ! command -v git >/dev/null 2>&1; then
  echo "Git is not installed on this computer."
  echo "Install it (e.g. 'xcode-select --install' on Mac, or your package manager on Linux), then run this script again."
  exit 1
fi

if [ ! -d ".git" ]; then
  echo "Setting up a new local repository..."
  git init
  git branch -M main
else
  echo "Existing local repository found - reusing it."
fi
echo

read -p "Paste your GitHub repository URL (e.g. https://github.com/yourname/ant-app.git): " REPOURL
if [ -z "$REPOURL" ]; then
  echo "No URL entered. Run this script again when you have one."
  exit 1
fi

git remote remove origin 2>/dev/null || true
git remote add origin "$REPOURL"

echo
echo "Staging and committing all files..."
git add -A
git commit -m "Ant App - dive centre booking, sales and finance software" || true

echo
echo "Pushing to GitHub..."
echo "(You may be asked to sign in - use your GitHub username, and a"
echo " Personal Access Token as the password, not your normal password.)"
echo

git push -u origin main

echo
echo "Done! Your code is now on GitHub."
