// ==UserScript==
// @name           Advanced Tab Groups (Bare Bones - No Collapse Logic)
// @ignorecache
// ==/UserScript==

class AdvancedTabGroups {
  constructor() {
    this.init();
  }

  async init() {
    await this.waitForDependencies();
    this.applySavedColors();
    this.applySavedIcons();
    this.setupObserver();
    this.addFolderContextMenuItems();
    this.removeBuiltinTabGroupMenu();
    this.processExistingGroups();

    setTimeout(() => this.processExistingGroups(), 1000);
    document.addEventListener("TabGroupCreate", this.onTabGroupCreate.bind(this));
    this.setupWorkspaceObserver();
    setTimeout(() => this.updateGroupVisibility(), 500);
  }

  setupObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                node.id === "tab-group-editor" ||
                node.nodeName?.toLowerCase() === "tabgroup-meu" ||
                node.querySelector?.("#tab-group-editor, tabgroup-meu")
              ) {
                this.removeBuiltinTabGroupMenu(node);
              }
              if (node.tagName === "tab-group" && !node.hasAttribute("split-view-group")) {
                this.processGroup(node);
              }
              const childGroups = node.querySelectorAll?.("tab-group") || [];
              childGroups.forEach((group) => {
                if (!group.hasAttribute("split-view-group")) {
                  this.processGroup(group);
                }
              });
            }
          });
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  waitForElm(selector) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  waitForDependencies() {
    return new Promise((resolve) => {
      const id = setInterval(() => {
        const deps = ["SessionStore", "gZenWorkspaces", "gZenThemePicker"];
        let depsExist = true;
        for (const dep of deps) {
          if (!window.hasOwnProperty(dep)) depsExist = false;
        }
        if (depsExist) {
          clearInterval(id);
          resolve();
        }
      }, 50);
    });
  }

  setupWorkspaceObserver() {
    const originalSwitchToWorkspace = window.gZenWorkspaces.switchToWorkspace;
    window.gZenWorkspaces.switchToWorkspace = (...args) => {
      const result = originalSwitchToWorkspace.apply(window.gZenWorkspaces, args);
      setTimeout(() => this.updateGroupVisibility(), 100);
      return result;
    };
    const workspaceObserver = new MutationObserver(() => {
      setTimeout(() => this.updateGroupVisibility(), 100);
    });
    const workspaceContainer = document.querySelector("#zen-workspaces-button");
    if (workspaceContainer) {
      workspaceObserver.observe(workspaceContainer, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["selected", "active"],
      });
    }
  }

  updateGroupVisibility() {
    try {
      const activeWorkspaceGroups = gZenWorkspaces?.activeWorkspaceStrip?.querySelectorAll("tab-group") || [];
      const activeGroupIds = new Set(Array.from(activeWorkspaceGroups).map((g) => g.id));
      this.tabGroups.forEach((group) => {
        if (group.hasAttribute && group.hasAttribute("split-view-group")) return;
        if (activeGroupIds.has(group.id)) {
          group.removeAttribute("hidden");
        } else {
          group.setAttribute("hidden", "true");
        }
      });
    } catch (error) {}
  }

  removeBuiltinTabGroupMenu(root = document) {
    try {
      const list = root.querySelectorAll ? root.querySelectorAll("#tab-group-editor, tabgroup-meu") : [];
      list.forEach((el) => el.remove());
      const byId = root.getElementById ? root.getElementById("tab-group-editor") : null;
      if (byId) byId.remove();
    } catch (e) {}
  }

  get tabGroups() {
    return gBrowser.tabGroups.filter((group) => group.tagName === "tab-group");
  }

  getGroupById(groupId) {
    return this.tabGroups.find((group) => group.id === groupId);
  }

  processExistingGroups() {
    this.tabGroups.forEach((group) => {
      if (!group.hasAttribute || !group.hasAttribute("split-view-group")) {
        this.processGroup(group);
      }
    });
  }

  _editingGroup = null;
  _groupEdited = null;

  renameGroupKeydown(event) {
    event.stopPropagation();
    if (event.key === "Enter") {
      let label = this._groupEdited;
      let input = document.getElementById("tab-label-input");
      let newName = input.value.trim();
      document.documentElement.removeAttribute("zen-renaming-group");
      input.remove();
      if (label && newName) {
        const group = label.closest("tab-group");
        if (group && newName !== group.label) group.label = newName;
      }
      label.classList.remove("tab-group-label-editing");
      label.style.display = "";
      this._groupEdited = null;
    } else if (event.key === "Escape") {
      event.target.blur();
    }
  }

  renameGroupStart(group, selectAll = true) {
    if (this._groupEdited) {
      const existingInput = document.getElementById("tab-label-input");
      if (existingInput) existingInput.remove();
      if (this._groupEdited) {
        this._groupEdited.classList.remove("tab-group-label-editing");
        this._groupEdited.style.display = "";
      }
      document.documentElement.removeAttribute("zen-renaming-group");
      this._groupEdited = null;
    }
    const labelElement = group.querySelector(".tab-group-label");
    if (!labelElement) return;
    this._groupEdited = labelElement;
    document.documentElement.setAttribute("zen-renaming-group", "true");
    labelElement.classList.add("tab-group-label-editing");
    labelElement.style.display = "none";
    const input = document.createElement("input");
    input.id = "tab-label-input";
    input.className = "tab-group-label";
    input.type = "text";
    input.value = group.label || labelElement.textContent || "";
    input.setAttribute("autocomplete", "off");
    labelElement.after(input);
    input.focus();
    if (selectAll) input.select();
    input.addEventListener("keydown", this.renameGroupKeydown.bind(this));
    input.addEventListener("blur", this.renameGroupHalt.bind(this));
  }

  renameGroupHalt(event) {
    if (!this._groupEdited || document.activeElement === event.target) return;
    document.documentElement.removeAttribute("zen-renaming-group");
    let input = document.getElementById("tab-label-input");
    if (input) input.remove();
    this._groupEdited.classList.remove("tab-group-label-editing");
    this._groupEdited.style.display = "";
    this._groupEdited = null;
  }

  processGroup(group) {
    if (group.hasAttribute("data-close-button-added") || group.classList.contains("zen-folder") || group.hasAttribute("zen-folder") || group.hasAttribute("split-view-group")) return;
    const labelContainer = group.querySelector(".tab-group-label-container");
    if (!labelContainer) return;
    if (labelContainer.querySelector(".tab-close-button")) return;

    const tabContainer = group.querySelector(".tab-group-container");
    const grain = document.createElement("div");
    grain.className = "grain";
    tabContainer.appendChild(grain);

    const groupDomFrag = window.MozXULElement.parseXULToFragment(`
      <div class="tab-group-icon-container">
        <div class="tab-group-icon"><div class="grain"></div></div>
        <image class="group-marker" role="button" keyNav="false" tooltiptext="Toggle Group"/>
      </div>
      <image class="tab-close-button close-icon" role="button" keyNav="false" tooltiptext="Close Group"/>
    `);
    
    labelContainer.insertBefore(groupDomFrag.children[0], labelContainer.firstChild);
    labelContainer.appendChild(groupDomFrag.children[1]);

    group.querySelector('.tab-close-button').addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      try {
        this.removeSavedColor(group.id);
        this.removeSavedIcon(group.id);
        gBrowser.removeTabGroup(group);
      } catch (error) {}
    });

    group.classList.remove("tab-group-editor-mode-create");
    this.addContextMenu(group);

    if (!group.label || group.label === "" || ("defaultGroupName" in group && group.label === group.defaultGroupName)) {
      this.renameGroupStart(group, false);
      group.color = `${group.id}-favicon`;
      if (typeof group._useFaviconColor === "function") group._useFaviconColor();
    } else {
      const currentColor = document.documentElement.style.getPropertyValue(`--tab-group-color-${group.id}`);
      if (!currentColor && !this.savedColors[group.id] && typeof group._useFaviconColor === "function") {
        group.color = `${group.id}-favicon`;
        group._useFaviconColor();
      }
    }
    setTimeout(() => this.updateGroupVisibility(), 50);
  }

  ensureSharedContextMenu() {
    if (this._sharedContextMenu) return this._sharedContextMenu;
    try {
      const contextMenuFrag = window.MozXULElement.parseXULToFragment(`
        <menupopup id="advanced-tab-groups-context-menu">
          <menu class="change-group-color" label="Change Color">
            <menupopup>
              <menuitem class="set-group-color" label="Edit Color"/>
              <menuitem class="use-favicon-color" label="Use Tab Icon Colors"/>
            </menupopup>
          </menu>
          <menuitem class="rename-group" label="Rename"/>
          <menuitem class="change-group-icon" label="Change Icon"/>
          <menuseparator/>
          <menuitem class="ungroup-tabs" label="Ungroup"/>
          <menuitem class="convert-group-to-folder" label="Convert to Folder"/>
        </menupopup>
      `);
      const contextMenu = contextMenuFrag.firstElementChild;
      document.body.appendChild(contextMenu);
      this._contextMenuCurrentGroup = null;

      const items = {
        ".set-group-color": "_setGroupColor",
        ".use-favicon-color": "_useFaviconColor",
        ".rename-group": this.renameGroupStart,
        ".change-group-icon": this.applyGroupIcon,
        ".ungroup-tabs": "ungroupTabs",
        ".convert-group-to-folder": this.convertGroupToFolder
      };

      for (const [selector, action] of Object.entries(items)) {
        const item = contextMenu.querySelector(selector);
        if (item) {
          item.addEventListener("command", () => {
            const group = this._contextMenuCurrentGroup;
            if (group && typeof action === "function") action.call(this, group);
            else if (group) group[action]();
          });
        }
      }

      contextMenu.addEventListener("popuphidden", () => this._contextMenuCurrentGroup = null);
      this._sharedContextMenu = contextMenu;
      return this._sharedContextMenu;
    } catch (error) { return null; }
  }

  addFolderContextMenuItems() {
    setTimeout(() => {
      const folderMenu = document.getElementById("zenFolderActions");
      if (!folderMenu || folderMenu.querySelector("#convert-folder-to-group")) return;
      const menuFragment = window.MozXULElement.parseXULToFragment(`<menuitem id="convert-folder-to-group" label="Convert Folder to Group"/>`);
      const convertToSpaceItem = folderMenu.querySelector("#context_zenFolderToSpace");
      if (convertToSpaceItem) convertToSpaceItem.after(menuFragment);
      else folderMenu.appendChild(menuFragment);

      folderMenu.addEventListener("command", (event) => {
        if (event.target.id === "convert-folder-to-group") {
          const folder = folderMenu.triggerNode?.closest("zen-folder");
          if (folder) this.convertFolderToGroup(folder);
        }
      });
    }, 1500);
  }

  updateIconColor(group, colors) {
    const groupIcon = group.querySelector(".group-icon");
    const shouldBeDarkMode = !gZenThemePicker.shouldBeDarkMode(typeof colors[0] === "object" ? gZenThemePicker.getMostDominantColor(colors) : colors);
    if (groupIcon) groupIcon.style.fill = shouldBeDarkMode ? "black" : "white";
  }

  onTabGroupCreate(event) {
    try {
      const group = event.target?.closest ? event.target.closest("tab-group") || (event.target.tagName === "tab-group" ? event.target : null) : null;
      if (!group || group.hasAttribute("split-view-group")) return;
      this.removeBuiltinTabGroupMenu();
      if (!group.hasAttribute("data-close-button-added")) this.processGroup(group);
      
      if (!group.label || group.label === "" || ("defaultGroupName" in group && group.label === group.defaultGroupName)) {
        if (!this._groupEdited) this.renameGroupStart(group, false);
        group.color = `${group.id}-favicon`;
        if (typeof group._useFaviconColor === "function") setTimeout(() => group._useFaviconColor(), 300);
      }
      setTimeout(() => this.updateGroupVisibility(), 100);
    } catch (e) {}
  }

  addContextMenu(group) {
    if (group._contextMenuAdded) return;
    group._contextMenuAdded = true;
    const sharedMenu = this.ensureSharedContextMenu();
    const labelContainer = group.querySelector(".tab-group-label-container");
    
    if (labelContainer) {
      labelContainer.removeAttribute("context");
      const existingListener = labelContainer._contextMenuListener;
      if (existingListener) labelContainer.removeEventListener("contextmenu", existingListener);
      const contextMenuListener = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._contextMenuCurrentGroup = group;
        sharedMenu.openPopupAtScreen(event.screenX, event.screenY, false);
      };
      labelContainer._contextMenuListener = contextMenuListener;
      labelContainer.addEventListener("contextmenu", contextMenuListener);
    }

    group.removeAttribute("context");
    group._renameGroupFromContextMenu = () => this.renameGroupStart(group);
    group._closeGroupFromContextMenu = () => {
      try { this.removeSavedColor(group.id); this.removeSavedIcon(group.id); gBrowser.removeTabGroup(group); } catch (error) {}
    };

    group._setGroupColor = async () => {
      let faviconColor;
      if (group.color.endsWith("favicon")) faviconColor = await group._useFaviconColor();
      group.color = group.id;

      if (window.gZenThemePicker) {
        try {
          const existingButton = document.getElementById("zenToolbarThemePicker");
          if (existingButton) {
            const originalUpdateMethod = window.gZenThemePicker.updateCurrentWorkspace;
            const calculateColor = () => {
              const dots = gZenThemePicker.panel.querySelectorAll(".zen-theme-picker-dot");
              const colors = Array.from(dots).sort((a, b) => a.getAttribute("data-index") - b.getAttribute("data-index")).map((dot) => {
                const color = dot.style.getPropertyValue("--zen-theme-picker-dot-color");
                if (color === "undefined") return null;
                const isCustom = dot.classList.contains("custom");
                return {
                  c: isCustom ? color : color.match(/\d+/g).map(Number),
                  isCustom, algorithm: this.useAlgo, isPrimary: dot.classList.contains("primary"),
                  lightness: 50, position: dot.getAttribute("data-position") && JSON.parse(dot.getAttribute("data-position")), type: dot.getAttribute("data-type"),
                };
              }).filter(Boolean);

              let gradient = "transparent";
              if (colors.length > 0) {
                gradient = gZenThemePicker.getGradient(colors);
                this.updateIconColor(group, colors);
              } else {
                const groupIcon = group.querySelector(".group-icon");
                if (groupIcon) groupIcon.style.fill = "light-dark(black, white)";
              }

              document.documentElement.style.setProperty(`--tab-group-color-${group.id}`, gradient);
              document.documentElement.style.setProperty(`--tab-group-color-${group.id}-invert`, gradient);
              group.style.setProperty("--group-grain", gZenThemePicker.currentTexture);
              group.setAttribute("show-grain", gZenThemePicker.currentTexture > 0);
              return colors;
            };

            const clickToAdd = document.querySelector("#PanelUI-zen-gradient-generator-color-click-to-add");
            window.gZenThemePicker.updateCurrentWorkspace = () => {
              try {
                const colors = calculateColor();
                clickToAdd.hidden = colors && colors.length > 0;
                const originalUpdateNoise = gZenThemePicker.updateNoise;
                gZenThemePicker.updateNoise = () => {};
                const fakeWindow = {
                  document: { documentElement: { style: { setProperty: () => {} }, setAttribute: () => {}, removeAttribute: () => {} }, getElementById: document.getElementById.bind(document), querySelectorAll: document.querySelectorAll.bind(document) },
                  gZenThemePicker,
                  gZenWorkspaces: { getActiveWorkspace: () => ({ uuid: group.id }), workspaceElement: () => null }
                };
                const originalWm = Services.wm;
                Services.wm = { getEnumerator: () => [fakeWindow] };
                gZenThemePicker.onWorkspaceChange({ uuid: group.id }, true, { type: undefined, gradientColors: colors, opacity: gZenThemePicker.currentOpacity, texture: gZenThemePicker.currentTexture });
                Services.wm = originalWm;
                gZenThemePicker.updateNoise = originalUpdateNoise;
              } catch (error) {}
            };

            existingButton.click();
            for (const dot of gZenThemePicker.panel.querySelectorAll(".zen-theme-picker-dot")) dot.remove();
            gZenThemePicker.dots = [];

            const previousOpacity = gZenThemePicker.currentOpacity;
            const previousTexture = gZenThemePicker.currentTexture;
            let theme = this.savedColors[group.id];

            if (faviconColor) {
              theme = { gradientColors: [{ c: faviconColor, isCustom: false, isPrimary: true, lightness: 50, position: gZenThemePicker.calculateInitialPosition(faviconColor), type: "undefined" }], opacity: 1, texture: 0 };
            }

            if (theme?.gradientColors?.length) {
              clickToAdd.hidden = true;
              gZenThemePicker.recalculateDots(theme.gradientColors);
              gZenThemePicker.currentOpacity = theme.opacity;
              gZenThemePicker.currentTexture = theme.texture;
            }

            const panel = window.gZenThemePicker.panel;
            const handlePanelClose = () => {
              try {
                this.savedColors = { ...this.savedColors, [group.id]: { gradientColors: calculateColor(), opacity: gZenThemePicker.currentOpacity, texture: gZenThemePicker.currentTexture } };
                gZenThemePicker.updateCurrentWorkspace = originalUpdateMethod;
                gZenThemePicker.currentOpacity = previousOpacity;
                gZenThemePicker.currentTexture = previousTexture;
                for (const dot of gZenThemePicker.panel.querySelectorAll(".zen-theme-picker-dot")) dot.remove();
                gZenThemePicker.dots = [];
                gZenThemePicker.recalculateDots(gZenWorkspaces.getActiveWorkspace().theme.gradientColors);
                panel.removeEventListener("popuphidden", handlePanelClose);
              } catch (error) {}
            };
            panel.addEventListener("popuphidden", handlePanelClose);
          }
        } catch (error) {}
      }
    };

    group._useFaviconColor = async () => {
      try {
        const favicons = group.querySelectorAll(".tab-icon-image");
        const colors = [];
        for (const favicon of Array.from(favicons)) {
          if (favicon?.src && favicon.src !== "chrome://global/skin/icons/defaultFavicon.svg") {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            const img = new Image();
            img.crossOrigin = "anonymous";
            let processedResolve;
            const processedPromise = new Promise((r) => (processedResolve = r));

            img.onload = () => {
              try {
                canvas.width = img.width || 16;
                canvas.height = img.height || 16;
                ctx.drawImage(img, 0, 0);
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                let r = 0, g = 0, b = 0, count = 0;
                for (let i = 0; i < data.length; i += 4) {
                  if (data[i + 3] > 128 && data[i] + data[i + 1] + data[i + 2] > 30) {
                    r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
                  }
                }
                if (count > 0) colors.push([Math.round(r / count), Math.round(g / count), Math.round(b / count)]);
                processedResolve(true);
              } catch (error) {}
            };
            img.onerror = () => processedResolve(true);
            setTimeout(() => { if (img.complete === false) processedResolve(true); }, 3000);
            img.src = favicon.src;
            await processedPromise;
          }
        }

        if (colors.length > 0) {
          group.color = `${group.id}-favicon`;
          const total = colors.reduce((acc, c) => [acc[0]+c[0], acc[1]+c[1], acc[2]+c[2]], [0,0,0]);
          const avgColor = [Math.round(total[0]/colors.length), Math.round(total[1]/colors.length), Math.round(total[2]/colors.length)];
          const colorString = `rgb(${avgColor[0]}, ${avgColor[1]}, ${avgColor[2]})`;

          document.documentElement.style.setProperty(`--tab-group-color-${group.id}-favicon`, colorString);
          document.documentElement.style.setProperty(`--tab-group-color-${group.id}-favicon-invert`, colorString);
          this.updateIconColor(group, avgColor);
          return avgColor;
        }
      } catch (error) {}
    };
  }

  convertGroupToFolder(group) {
    try {
      if (!window.gZenFolders || group.tabs.length === 0) return;
      if (window.gZenFolders.createFolder(Array.from(group.tabs), { label: group.label || "New Folder", renameFolder: false, workspaceId: group.getAttribute("zen-workspace-id") || window.gZenWorkspaces?.activeWorkspace })) {
        try { gBrowser.removeTabGroup(group); } catch (e) {}
        this.removeSavedColor(group.id);
        this.removeSavedIcon(group.id);
      }
    } catch (e) {}
  }

  convertFolderToGroup(folder) {
    try {
      const tabsToGroup = folder.allItemsRecursive.filter((item) => gBrowser.isTab(item) && !item.hasAttribute("zen-empty-tab"));
      if (tabsToGroup.length === 0) {
        if (folder?.isConnected && typeof folder.delete === "function") folder.delete();
        return;
      }
      tabsToGroup.forEach((tab) => { if (tab.pinned) gBrowser.unpinTab(tab); });
      setTimeout(() => {
        try {
          const newGroup = document.createXULElement("tab-group");
          newGroup.id = `${Date.now()}-${Math.round(Math.random() * 100)}`;
          newGroup.label = folder.label || "New Group";
          const container = gZenWorkspaces.activeWorkspaceStrip || gBrowser.tabContainer.querySelector("tabs");
          container.prepend(newGroup);
          newGroup.addTabs(tabsToGroup);
          if (folder?.isConnected && typeof folder.delete === "function") folder.delete();
          this.processGroup(newGroup);
        } catch (e) {}
      }, 200);
    } catch (e) {}
  }

  get savedColors() {
    try { const c = SessionStore.getCustomWindowValue(window, "tabGroupColors"); return c ? JSON.parse(c) : {}; } catch (e) { return {}; }
  }
  set savedColors(val) { try { SessionStore.setCustomWindowValue(window, "tabGroupColors", JSON.stringify(val)); } catch (e) {} }

  applySavedColors() {
    Object.entries(this.savedColors).forEach(async ([groupId, color]) => {
      if (typeof color === "object" && color.gradientColors) {
        const prevOpacity = gZenThemePicker.currentOpacity;
        gZenThemePicker.currentOpacity = color.opacity || 1;
        const gradient = gZenThemePicker.getGradient(color.gradientColors);
        document.documentElement.style.setProperty(`--tab-group-color-${groupId}`, gradient);
        document.documentElement.style.setProperty(`--tab-group-color-${groupId}-invert`, gradient);
        gZenThemePicker.currentOpacity = prevOpacity;
        if (color.texture) {
          const group = await this.waitForElm(`tab-group[id="${groupId}"]`);
          if (group) { group.style.setProperty("--group-grain", color.texture); group.setAttribute("show-grain", color.texture > 0); }
        }
      } else if (typeof color === "string" && color.trim() !== "") {
        document.documentElement.style.setProperty(`--tab-group-color-${groupId}`, color);
        document.documentElement.style.setProperty(`--tab-group-color-${groupId}-invert`, color);
      }
    });
  }

  removeSavedColor(id) { const c = this.savedColors; delete c[id]; this.savedColors = c; }

  get savedIcons() {
    try { const i = SessionStore.getCustomWindowValue(window, "tabGroupIcons"); return i ? JSON.parse(i) : {}; } catch (e) { return {}; }
  }
  set savedIcons(val) { try { SessionStore.setCustomWindowValue(window, "tabGroupIcons", JSON.stringify(val)); } catch (e) {} }

  async applyGroupIcon(group, iconUrl = null) {
    const iconContainer = await this.waitForElm(`tab-group[id="${group.id}"] .tab-group-icon-container`);
    let iconElement = iconContainer.querySelector(".tab-group-icon") || Object.assign(document.createElement("div"), { className: "tab-group-icon" });
    if (!iconContainer.contains(iconElement)) iconContainer.appendChild(iconElement);
    if (!iconUrl) iconUrl = await window.gZenEmojiPicker.open(iconElement, { onlySvgIcons: !Services.prefs.getBoolPref("browser.tabs.groups.allow-emojis", false) });
    iconElement.querySelector("image")?.remove();
    iconElement.querySelector("label")?.remove();

    if (iconUrl) {
      iconElement.appendChild(window.MozXULElement.parseXULToFragment(iconUrl.endsWith(".svg") ? `<image src="${iconUrl}" class="group-icon" alt="Group Icon"/>` : `<label>${iconUrl}</label>`).firstElementChild);
      this.updateIconColor(group, this.savedColors[group.id]?.gradientColors || []);
      const icons = this.savedIcons; icons[group.id] = iconUrl; this.savedIcons = icons;
    } else {
      const icons = this.savedIcons; delete icons[group.id]; this.savedIcons = icons;
    }
  }

  applySavedIcons() {
    Object.entries(this.savedIcons).forEach(([id, url]) => { const g = this.getGroupById(id); if (g && !g.hasAttribute("split-view-group")) this.applyGroupIcon(g, url); });
  }
  removeSavedIcon(id) { const i = this.savedIcons; delete i[id]; this.savedIcons = i; }
}

(function () {
  if (!globalThis.advancedTabGroups) {
    const initATG = () => { globalThis.advancedTabGroups = new AdvancedTabGroups(); };
    document.readyState === "complete" ? initATG() : window.addEventListener("load", initATG);

    const tabContextMenu = document.getElementById("tabContextMenu");
    if (tabContextMenu) {
      tabContextMenu.addEventListener("popupshowing", () => {
        const foldersToHide = Array.from(gBrowser.tabContainer.querySelectorAll("zen-folder")).map((f) => f.id);
        const activeWorkspaceGroups = gZenWorkspaces?.activeWorkspaceStrip?.querySelectorAll("tab-group") || [];
        const activeGroupIds = new Set(Array.from(activeWorkspaceGroups).map((g) => g.id));
        const inactiveGroupIds = gBrowser.tabGroups.filter((g) => !activeGroupIds.has(g.id) && !g.hasAttribute("split-view-group")).map((g) => g.id);
        const itemsToHide = [...foldersToHide, ...inactiveGroupIds];
        document.querySelectorAll("#context_moveTabToGroupPopupMenu menuitem[tab-group-id]").forEach(item => {
          item.hidden = itemsToHide.includes(item.getAttribute("tab-group-id"));
        });
      });
    }
  }
})();