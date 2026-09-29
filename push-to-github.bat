@echo off
setlocal enabledelayedexpansion
title Ant App - Push to GitHub
echo ============================================
echo    Ant App - Push to GitHub
echo ============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed on this computer.
  echo Download it from https://git-scm.com/downloads, install it,
  echo then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist ".git" (
  echo Setting up a new local repository...
  git init
  git branch -M main
) else (
  echo Existing local repository found - reusing it.
)
echo.

set REPOURL=
set /p REPOURL=Paste your GitHub repository URL (e.g. https://github.com/yourname/ant-app.git):
if "%REPOURL%"=="" (
  echo No URL entered. Run this file again when you have one.
  pause
  exit /b 1
)

git remote remove origin >nul 2>nul
git remote add origin "%REPOURL%"

echo.
echo Staging and committing all files...
git add -A
git commit -m "Ant App - dive centre booking, sales and finance software" >nul 2>nul

echo.
echo Pushing to GitHub...
echo (A window or prompt may ask you to sign in - use your GitHub
echo  username, and a Personal Access Token as the password, not
echo  your normal GitHub password.)
echo.
git push -u origin main

echo.
if errorlevel 1 (
  echo Something went wrong - scroll up to see the error message.
) else (
  echo Done! Your code is now on GitHub.
)
echo.
pause
