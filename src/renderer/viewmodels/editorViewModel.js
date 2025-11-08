const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const appRoot = path.join(__dirname, '..', '..', '..');
const dataDirectory = path.join(appRoot, 'data');
const configPath = path.join(appRoot, 'config', 'config.json');

document.addEventListener('DOMContentLoaded', () => {
    let currentActiveGrid = null;
    const keyboardKeys = document.querySelectorAll('#keyboard td');
    let gridBoxes;
    const editableFields = document.querySelectorAll('.editable-field');
    let currentEditingField = null;
    let originalValue = '';
    let keyMapData = null;
    let hasUnsavedChanges = false;

    // Get the sheet index from the URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const sheetIndex = urlParams.get('sheetIndex');    // Load and apply theme
    function loadTheme() {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, { encoding: 'utf8' }));
            const theme = config.appTheme || 'dark';
            if (theme === 'dark') {
                document.body.classList.add('dark-mode');
            } else {
                document.body.classList.remove('dark-mode');
            }
        } catch (error) {
            console.error('Error loading theme:', error);
            document.body.classList.add('dark-mode');
        }
    }

    ipcRenderer.on('theme-changed', (event, theme) => {
        if (theme === 'dark') {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
    });

    // Initial theme load
    loadTheme();

    // Load sheet data
    let sheetData = null;
    if (sheetIndex !== null) {
        try {
            const listSheet = JSON.parse(
                fs.readFileSync(path.join(dataDirectory, 'listSheet.json'), {
                    encoding: 'utf8',
                })
            );
            sheetData = listSheet[sheetIndex];
            
            // Load keymap data
            if (sheetData.keyMap) {
                keyMapData = JSON.parse(
                    fs.readFileSync(path.join(dataDirectory, sheetData.keyMap), {
                        encoding: 'utf8',
                    })
                );
            }
            
            updateFieldValues(sheetData);
            // Generate grid boxes
            generateGridBoxes(keyMapData);
            // Initialize grid with keymap data
            initializeGrid(keyMapData);
            gridBoxes = document.querySelectorAll('.grid-box');
            setupGridEventListeners();
        } catch (error) {
            console.error('Error loading sheet data:', error);
        }
    }

    function updateFieldValues(data) {
        if (!data) return;
        
        const fields = {
            name: data.name || 'Untitled',
            author: data.author || 'Unknown',
            transcribedBy: data.transcribedBy || 'Unknown',
            bpm: data.bpm || '120'
        };

        editableFields.forEach(field => {
            const fieldType = field.getAttribute('data-field');
            if (fields[fieldType]) {
                field.querySelector('.field-value').textContent = fields[fieldType];
            }
        });
    }

    function generateGridBoxes(keyMapData) {
        if (!keyMapData) return;

        const gridContainer = document.querySelector('.grid-boxes');
        const timestamps = Object.keys(keyMapData).sort((a, b) => parseInt(a) - parseInt(b));
        
        gridContainer.innerHTML = '';
        
        // Create a box for every timestamp in the keymap
        timestamps.forEach((timeMs, index) => {
            const gridColumn = document.createElement('div');
            gridColumn.className = 'grid-column';
            
            const gridBox = document.createElement('div');
            gridBox.className = 'grid-box';
            gridBox.setAttribute('data-time', timeMs);
            gridBox.style.animationDelay = `${index * 0.05}s`;
            
            // Create grid dots
            for (let j = 0; j < 15; j++) {
                const dot = document.createElement('div');
                dot.setAttribute('data-key', '');
                gridBox.appendChild(dot);
            }
            
            const timestamp = document.createElement('div');
            timestamp.className = 'timestamp';
            const seconds = Math.floor(parseInt(timeMs) / 1000);
            const ms = parseInt(timeMs) % 1000;
            timestamp.textContent = `${seconds}.${ms.toString().padStart(3, '0')}s`;
            
            gridColumn.appendChild(gridBox);
            gridColumn.appendChild(timestamp);
            gridContainer.appendChild(gridColumn);
        });
    }

    function initializeGrid(keyMapData) {
        if (!keyMapData) return;

        const timestamps = Object.keys(keyMapData).sort((a, b) => parseInt(a) - parseInt(b));
        const gridBoxes = document.querySelectorAll('.grid-box');
        
        gridBoxes.forEach((box) => {
            const dots = box.querySelectorAll('div');
            dots.forEach(dot => dot.setAttribute('data-key', ''));
            const timeMs = box.getAttribute('data-time');
            if (keyMapData[timeMs] && keyMapData[timeMs].length > 0) {
                keyMapData[timeMs].forEach(key => {
                    const keyIndex = getKeyIndex(key);
                    if (keyIndex >= 0 && keyIndex < dots.length) {
                        dots[keyIndex].setAttribute('data-key', key);
                    }
                });
            }
        });
    }

    function getKeyIndex(key) {
        const keyMap = {
            'y': 0, 'u': 1, 'i': 2, 'o': 3, 'p': 4,
            'h': 5, 'j': 6, 'k': 7, 'l': 8, ';': 9,
            'n': 10, 'm': 11, ',': 12, '.': 13, '/': 14
        };
        return keyMap[key];
    }

    function updateGridBox(box, keys) {
        const dots = box.querySelectorAll('div');
        dots.forEach(dot => dot.setAttribute('data-key', ''));
        
        keys.forEach(key => {
            const keyIndex = getKeyIndex(key);
            if (keyIndex >= 0 && keyIndex < dots.length) {
                dots[keyIndex].setAttribute('data-key', key);
            }
        });
    }

    function saveKeyMapChanges() {
        if (!hasUnsavedChanges || !sheetData || !keyMapData) return;

        try {
            // Save keymap changes
            fs.writeFileSync(
                path.join(dataDirectory, sheetData.keyMap),
                JSON.stringify(keyMapData),
                { mode: 0o666 }
            );
            ipcRenderer.send('keymap-updated', {
                index: parseInt(sheetIndex)
            });
            
            // Show success message using notie
            notie.alert({ type: 'success', text: 'Sheet saved successfully!', time: 2 });

            hasUnsavedChanges = false;
            
            // Hide edit buttons
            const buttons = document.querySelector('#keyboard .edit-buttons');
            buttons.classList.remove('visible');
        } catch (error) {
            console.error('Error saving keymap:', error);
            notie.alert({ type: 'error', text: 'Failed to save changes to the music sheet', time: 3 });
        }
    }

    function setupGridEventListeners() {
        // Grid click handler
        gridBoxes.forEach(box => {
            box.addEventListener('click', () => {
                const timeMs = box.getAttribute('data-time');
                if (!keyMapData[timeMs]) {
                    keyMapData[timeMs] = [];
                }
                
                // Remove active state from previously selected grid
                if (currentActiveGrid) {
                    currentActiveGrid.classList.remove('active');
                    // Clear keyboard highlights
                    clearKeyboardHighlights();
                }
                
                currentActiveGrid = box;
                currentActiveGrid.classList.add('active');
                
                // Highlight keyboard keys for this timestamp
                highlightKeyboardKeys(timeMs);
                
                // Show edit buttons
                const buttons = document.querySelector('#keyboard .edit-buttons');
                buttons.classList.add('visible');
            });
        });
    }

    function clearKeyboardHighlights() {
        keyboardKeys.forEach(key => {
            key.classList.remove('active');
        });
    }

    function highlightKeyboardKeys(timeMs) {
        clearKeyboardHighlights();
        
        if (keyMapData[timeMs] && keyMapData[timeMs].length > 0) {
            keyMapData[timeMs].forEach(key => {
                const keyElement = findKeyElement(key);
                if (keyElement) {
                    keyElement.classList.add('active');
                }
            });
        }
    }

    function findKeyElement(keyValue) {
        return Array.from(keyboardKeys).find(key => 
            key.querySelector('input').value.toLowerCase() === keyValue.toLowerCase()
        );
    }

    // Update keyboard click handler
    keyboardKeys.forEach(key => {
        key.addEventListener('click', () => {
            if (!currentActiveGrid || !keyMapData) return;
            
            const keyValue = key.querySelector('input').value.toLowerCase();
            const timeMs = currentActiveGrid.getAttribute('data-time');
            
            if (!keyMapData[timeMs]) {
                keyMapData[timeMs] = [];
            }
            
            const keyIndex = keyMapData[timeMs].indexOf(keyValue);
            if (keyIndex === -1) {
                keyMapData[timeMs].push(keyValue);
                key.classList.add('active');
            } else {
                keyMapData[timeMs].splice(keyIndex, 1);
                key.classList.remove('active');
            }
            
            updateGridBox(currentActiveGrid, keyMapData[timeMs]);
            hasUnsavedChanges = true;
        });
    });

    // Add event listeners for editable fields
    editableFields.forEach(field => {
        field.addEventListener('click', () => {
            startEditing(field);
        });
    });

    function startEditing(field) {
        if (currentEditingField) {
            cancelEditing();
        }

        currentEditingField = field;
        field.classList.add('editing');
        const valueSpan = field.querySelector('.field-value');
        originalValue = valueSpan.textContent;
        valueSpan.contentEditable = true;
        valueSpan.classList.add('editing');
        valueSpan.focus();

        // Show edit buttons
        const buttons = document.querySelector('#keyboard .edit-buttons');
        buttons.classList.add('visible');

        const range = document.createRange();
        range.selectNodeContents(valueSpan);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function saveEditing() {
        if (!currentEditingField || !sheetData) return;

        const field = currentEditingField;
        const fieldType = field.getAttribute('data-field');
        const valueSpan = field.querySelector('.field-value');
        let newValue = valueSpan.textContent.trim();
        if (fieldType === 'bpm') {
            const bpmValue = parseInt(newValue);
            if (isNaN(bpmValue) || bpmValue <= 0) {
                notie.alert({ type: 'error', text: 'Please enter a valid BPM number (must be greater than 0)', time: 3 });
                valueSpan.textContent = originalValue;
                cancelEditing();
                return;
            }
            newValue = bpmValue;
        }

        // Update the sheet data
        sheetData[fieldType] = newValue;

        try {
            // Read current listSheet.json
            const listSheet = JSON.parse(
                fs.readFileSync(path.join(dataDirectory, 'listSheet.json'), {
                    encoding: 'utf8',
                })
            );

            // Update the specific sheet
            listSheet[sheetIndex] = sheetData;

            fs.writeFileSync(
                path.join(dataDirectory, 'listSheet.json'),
                JSON.stringify(listSheet, null, 4)
            );
            ipcRenderer.send('update-sheet-list', {
                index: parseInt(sheetIndex),
                data: sheetData
            });

            // Show success message using notie
            notie.alert({ type: 'success', text: 'Changes saved successfully!', time: 2 });

            endEditing();
        } catch (error) {
            console.error('Error saving sheet data:', error);
            notie.alert({ type: 'error', text: 'Failed to save changes to the sheet', time: 3 });
            valueSpan.textContent = originalValue;
            endEditing();
        }
    }

    function cancelEditing() {
        if (!currentEditingField) return;
        
        const valueSpan = currentEditingField.querySelector('.field-value');
        valueSpan.textContent = originalValue;
        endEditing();
    }

    function endEditing() {
        if (!currentEditingField) return;

        const valueSpan = currentEditingField.querySelector('.field-value');
        valueSpan.contentEditable = false;
        valueSpan.classList.remove('editing');
        currentEditingField.classList.remove('editing');
        
        // Hide edit buttons
        const buttons = document.querySelector('#keyboard .edit-buttons');
        buttons.classList.remove('visible');
        
        currentEditingField = null;
        originalValue = '';
    }

    // Add event listeners for save and cancel buttons
    const saveBtn = document.querySelector('#keyboard .save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            if (currentEditingField) {
                saveEditing();
            } else if (hasUnsavedChanges) {
                saveKeyMapChanges();
            }
        });
    }

    const cancelBtn = document.querySelector('#keyboard .cancel-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (currentEditingField) {
                cancelEditing();
            } else if (hasUnsavedChanges) {
                if (confirm('Discard changes to the music sheet?')) {
                    initializeGrid(keyMapData);
                    hasUnsavedChanges = false;
                    const buttons = document.querySelector('#keyboard .edit-buttons');
                    buttons.classList.remove('visible');
                }
            }
        });
    }

    // Add keyboard mapping
    const validKeys = {
        'y': 'y', 'u': 'u', 'i': 'i', 'o': 'o', 'p': 'p',
        'h': 'h', 'j': 'j', 'k': 'k', 'l': 'l', ';': ';',
        'n': 'n', 'm': 'm', ',': ',', '.': '.', '/': '/'
    };

    // Add keyboard input handler
    document.addEventListener('keydown', (e) => {
        // Don't handle keys if we're editing a field
        if (currentEditingField) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                saveEditing();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEditing();
            }
            return;
        }

        const key = e.key.toLowerCase();
        
        // Handle Escape key for grid selection
        if (key === 'escape') {
            const buttons = document.querySelector('#keyboard .edit-buttons');
            buttons.classList.remove('visible');
            if (currentActiveGrid) {
                currentActiveGrid.classList.remove('active');
                clearKeyboardHighlights();
            }
            currentActiveGrid = null;
            return;
        }

        // Handle Ctrl+S for saving
        if (e.ctrlKey && key === 's') {
            e.preventDefault();
            if (hasUnsavedChanges) {
                saveKeyMapChanges();
            }
            return;
        }

        if (validKeys[key] && currentActiveGrid && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault(); // Prevent default key behavior

            const timeMs = currentActiveGrid.getAttribute('data-time');
            if (!keyMapData[timeMs]) {
                keyMapData[timeMs] = [];
            }

            // Find the corresponding keyboard key element
            const keyElement = findKeyElement(key);
            
            // Toggle the key in the current timestamp
            const keyIndex = keyMapData[timeMs].indexOf(key);
            if (keyIndex === -1) {
                // Add the key
                keyMapData[timeMs].push(key);
                if (keyElement) {
                    keyElement.classList.add('active');
                }
            } else {
                // Remove the key
                keyMapData[timeMs].splice(keyIndex, 1);
                if (keyElement) {
                    keyElement.classList.remove('active');
                }
            }

            // Update the grid display
            updateGridBox(currentActiveGrid, keyMapData[timeMs]);
            hasUnsavedChanges = true;

            if (keyElement) {
                keyElement.classList.add('pressed');
                setTimeout(() => {
                    keyElement.classList.remove('pressed');
                }, 100);
            }
        }
    });

    document.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (validKeys[key]) {
            const keyElement = findKeyElement(key);
            if (keyElement) {
                keyElement.classList.remove('pressed');
            }
        }
    });

    // Add export logic
    function getOriginalSheetFormat(sheetData, keyMapData) {
        // Map keyMapData back to songNotes array
        const keyOrder = ['y', 'u', 'i', 'o', 'p', 'h', 'j', 'k', 'l', ';', 'n', 'm', ',', '.', '/'];
        let songNotes = [];
        if (keyMapData) {
            Object.keys(keyMapData).forEach(time => {
                keyMapData[time].forEach(key => {
                    const keyIndex = keyOrder.indexOf(key);
                    if (keyIndex !== -1) {
                        songNotes.push({ time: Number(time), key: `1Key${keyIndex}` });
                    }
                });
            });
            songNotes.sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
        }
        // Compose the original format object
        return [{
            name: sheetData.name || 'Untitled',
            author: sheetData.author || 'Unknown',
            transcribedBy: sheetData.transcribedBy || 'Unknown',
            isComposed: sheetData.isComposed || true,
            bpm: sheetData.bpm || 120,
            bitsPerPage: sheetData.bitsPerPage,
            pitchLevel: sheetData.pitchLevel,
            isEncrypted: false,
            songNotes
        }];
    }

    // Use Electron's dialog to save file
    async function triggerSaveDialog(defaultName, contentObj) {
        // Ask main process to show save dialog
        const { filePath, canceled } = await ipcRenderer.invoke('show-export-dialog', {
            defaultPath: defaultName,
            filters: [
                { name: 'Text File', extensions: ['txt'] },
                { name: 'JSON File', extensions: ['json'] },
                { name: 'SkySheet File', extensions: ['skysheet'] },
            ]
        });
        if (canceled || !filePath) return;
        // Determine format from extension
        let ext = filePath.split('.').pop().toLowerCase();
        let content = '';
        if (ext === 'txt') {
            content = JSON.stringify(contentObj);
        } else if (ext === 'json' || ext === 'skysheet') {
            content = JSON.stringify(contentObj, null, 4);
        } else {
            content = JSON.stringify(contentObj, null, 4);
        }
        await ipcRenderer.invoke('save-exported-file', { filePath, content });
    }    // Add event listener for export button
    const exportBtn = document.querySelector('.export-button-bottom-right');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            if (!sheetData || !keyMapData) {
                notie.alert({ type: 'warning', text: 'No sheet loaded to export.', time: 3 });
                return;
            }
            const originalFormat = getOriginalSheetFormat(sheetData, keyMapData);
            let defaultName = (sheetData.name || 'Sheet') + '.txt';
            await triggerSaveDialog(defaultName, originalFormat);
        });
    }
}); 