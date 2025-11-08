(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global.notie = factory());
}(this, (function () { 
'use strict';

const positions = {
  top: 'top',
  bottom: 'bottom'
}

let options = {
  alertTime: 5,
  dateMonths: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  overlayClickDismiss: true,
  transitionCurve: 'cubic-bezier(0.215, 0.610, 0.355, 1)',
  transitionDuration: 0.4,
  classes: {
    masterContainer: 'notie-master-container',
    container: 'notie-container',
    hiding: 'notie-hiding',
    progressBar: 'notie-progress-bar',
    textbox: 'notie-textbox',
    textboxInner: 'notie-textbox-inner',
    button: 'notie-button',
    overlay: 'notie-overlay',
    backgroundSuccess: 'notie-background-success',
    backgroundWarning: 'notie-background-warning',
    backgroundError: 'notie-background-error',
    backgroundInfo: 'notie-background-info',
    backgroundNeutral: 'notie-background-neutral',
    inputField: 'notie-input-field',
    popupContainer: 'notie-popup-container',
    popup: 'notie-popup',
    buttonContainer: 'notie-button-container'
  },
  ids: {
    masterContainer: 'notie-master-container',
    overlay: 'notie-overlay'
  }
}

const setOptions = newOptions => {
  options = {
    ...options,
    ...newOptions,
    classes: { ...options.classes, ...newOptions.classes },
    ids: { ...options.ids, ...newOptions.ids }
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const wait = time => new Promise(resolve => setTimeout(resolve, time * 1000))

const blur = () => {
  document.activeElement && document.activeElement.blur()
}

const generateRandomId = () => {
  return `notie-${'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })}`
}

const typeToClassLookup = {
  1: options.classes.backgroundSuccess,
  success: options.classes.backgroundSuccess,
  2: options.classes.backgroundWarning,
  warning: options.classes.backgroundWarning,
  3: options.classes.backgroundError,
  error: options.classes.backgroundError,
  4: options.classes.backgroundInfo,
  info: options.classes.backgroundInfo,
  5: options.classes.backgroundNeutral,
  neutral: options.classes.backgroundNeutral
}

const enterClicked = event => event.keyCode === 13
const escapeClicked = event => event.keyCode === 27

const getMasterContainer = () => {
  let master = document.getElementById(options.ids.masterContainer);
  if (!master) {
    master = document.createElement('div');
    master.id = options.ids.masterContainer;
    document.body.appendChild(master);
  }
  return master;
}

const addToDocument = (element) => {
  const master = getMasterContainer();
  master.insertBefore(element, master.firstChild);
}

const removeFromDocument = (element) => {
  if (!element || !element.parentNode) return;

  if (element.listener) {
    window.removeEventListener('keydown', element.listener);
  }

  element.classList.add(options.classes.hiding);

  element.addEventListener('animationend', (e) => {
    if (e.animationName === 'notie-slide-out' && element.parentNode) {
      element.parentNode.removeChild(element);
    }
  });
}

const hideAlerts = (callback) => {
  const master = document.getElementById(options.ids.masterContainer);
  if (master) {
    const alertsShowing = master.children;
    for (let i = alertsShowing.length - 1; i >= 0; i--) {
      removeFromDocument(alertsShowing[i]);
    }
  }
  if (callback) {
    wait(options.transitionDuration).then(() => callback());
  }
}

const removeOverlayFromDocument = () => {
  const element = document.getElementById(options.ids.overlay);
  if (element && element.parentNode) {
    element.parentNode.removeChild(element);
  }
}

const createPopup = (params) => {
    blur();
    hideAlerts();

    const id = generateRandomId();

    const popup = document.createElement('div');
    popup.id = id;
    popup.classList.add(options.classes.popup);

    if (params.text) {
        const elementText = document.createElement('div');
        elementText.classList.add(options.classes.textbox);
        elementText.innerHTML = `<div class="${options.classes.textboxInner}">${params.text}</div>`;
        popup.appendChild(elementText);
    }

    if (params.inputField) {
        const inputContainer = document.createElement('div');
        inputContainer.appendChild(params.inputField);
        popup.appendChild(inputContainer);
    }

    if (params.buttons && params.buttons.length > 0) {
        const buttonContainer = document.createElement('div');
        buttonContainer.classList.add(options.classes.buttonContainer);
        params.buttons.forEach(btnInfo => {
            const button = document.createElement('button');
            button.classList.add(options.classes.button);
            if (btnInfo.type) {
                button.classList.add(typeToClassLookup[btnInfo.type]);
            }
            button.innerHTML = btnInfo.text;
            button.onclick = btnInfo.handler;
            buttonContainer.appendChild(button);
        });
        popup.appendChild(buttonContainer);
    }

    const container = document.createElement('div');
    container.classList.add(options.classes.popupContainer);
    container.appendChild(popup);
    document.body.appendChild(container);

    const hide = () => {
        if (container.parentNode) {
            container.parentNode.removeChild(container);
        }
        removeOverlayFromDocument();
        if (popup.listener) {
            window.removeEventListener('keydown', popup.listener);
        }
    };

    const overlay = document.createElement('div');
    overlay.id = options.ids.overlay;
    overlay.classList.add(options.classes.overlay);
    if (options.overlayClickDismiss) {
        overlay.onclick = () => hide();
    }
    document.body.appendChild(overlay);

    if (params.onKeyDown) {
        popup.listener = params.onKeyDown;
        window.addEventListener('keydown', popup.listener);
    }
    
    return { hide };
};

const alert = ({ type = 4, text, time = options.alertTime, stay = false }) => {
  blur();

  const element = document.createElement('div');
  element.id = generateRandomId();
  element.classList.add(options.classes.container);
  element.classList.add(typeToClassLookup[type]);

  element.innerHTML = `<div class="${options.classes.textbox}"><div class="${options.classes.textboxInner}">${text}</div></div>`;

  // Create and add close button
  const closeButton = document.createElement('button');
  closeButton.classList.add('notie-close-button');
  closeButton.onclick = (e) => {
    e.stopPropagation(); // Prevent the container's click event from firing
    removeFromDocument(element);
  };
  element.appendChild(closeButton);

  // Clicking the body of the notification also closes it
  element.onclick = () => removeFromDocument(element);

  if (!stay && time > 0) {
    const progressBar = document.createElement('div');
    progressBar.classList.add(options.classes.progressBar);
    progressBar.style.animationDuration = `${time}s`;
    element.appendChild(progressBar);
    wait(time).then(() => removeFromDocument(element));
  }

  addToDocument(element);
}

const confirm = ({ text, submitText = 'Yes', cancelText = 'Cancel', submitCallback, cancelCallback }) => {
    let popupInstance;
    const submitHandler = () => {
        popupInstance.hide();
        if (submitCallback) submitCallback();
    };
    const cancelHandler = () => {
        popupInstance.hide();
        if (cancelCallback) cancelCallback();
    };
    popupInstance = createPopup({
        text,
        buttons: [
            { text: cancelText, type: 5, handler: cancelHandler },
            { text: submitText, type: 1, handler: submitHandler }
        ],
        onKeyDown: (event) => {
            if (enterClicked(event)) submitHandler();
            else if (escapeClicked(event)) cancelHandler();
        }
    });
};

const force = ({ type = 5, text, buttonText = 'OK', callback }) => {
    let popupInstance;
    const handler = () => {
        popupInstance.hide();
        if (callback) callback();
    };
    popupInstance = createPopup({
        text,
        buttons: [{ text: buttonText, type, handler }],
        onKeyDown: (event) => {
            if (enterClicked(event) || escapeClicked(event)) handler();
        }
    });
};

const input = ({ text, submitText = 'Submit', cancelText = 'Cancel', submitCallback, cancelCallback, ...settings }) => {
    let popupInstance;

    const elementInput = document.createElement('input');
    elementInput.classList.add(options.classes.inputField);

    const attributes = [
        'autocapitalize', 'autocomplete', 'autocorrect', 'autofocus', 'inputmode', 
        'max', 'maxlength', 'min', 'minlength', 'placeholder', 'spellcheck', 'step', 'type'
    ];
    attributes.forEach(attr => {
        if (settings[attr]) elementInput.setAttribute(attr, settings[attr]);
    });
    elementInput.value = settings.value || '';

    const submitHandler = () => {
        popupInstance.hide();
        if (submitCallback) submitCallback(elementInput.value);
    };
    const cancelHandler = () => {
        popupInstance.hide();
        if (cancelCallback) cancelCallback(elementInput.value);
    };

    popupInstance = createPopup({
        text,
        inputField: elementInput,
        buttons: [
            { text: cancelText, type: 5, handler: cancelHandler },
            { text: submitText, type: 1, handler: submitHandler }
        ],
        onKeyDown: (event) => {
            if (enterClicked(event)) submitHandler();
            else if (escapeClicked(event)) cancelHandler();
        }
    });

    if (settings.autofocus !== 'false') {
        tick().then(() => elementInput.focus());
    }
};

// Note: `select` and `date` are not included in this modernization pass
// as they require significant custom UI that was not specified in the request.
// The original functions can be adapted to the new `createPopup` model if needed.

const notie = {
  alert,
  force,
  confirm,
  input,
  // select, // Temporarily disabled
  // date, // Temporarily disabled
  setOptions,
  hideAlerts
};

return notie;

})));
