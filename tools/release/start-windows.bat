@echo off
rem Scheldemist: double-click to play. Keep this window open while you play; close it to stop the game.
title Scheldemist
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0launch.mjs"
if errorlevel 1 pause
