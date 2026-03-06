// ==UserScript==
// @name           Zen Tab Groups
// @version        1.14.1
// @description    Fixes the invisible index swap bug using dragend listeners.
// @author         Rajb16
// @include        main
// @onlyonce
// ==/UserScript==

(function () {
  if (window.location.href !== "chrome://browser/content/browser.xhtml") return;

  const ZenGroups = {
    isMovingMultiple: false,

    getValidSibling(el, direction) {
      let sibling =
        direction === "prev"
          ? el.previousElementSibling
          : el.nextElementSibling;
      while (sibling) {
        if (
          sibling.classList &&
          sibling.classList.contains("zen-custom-group-header")
        )
          return sibling;
        if (
          sibling.tagName &&
          sibling.tagName.toLowerCase() === "tab" &&
          !sibling.closing
        )
          return sibling;
        sibling =
          direction === "prev"
            ? sibling.previousElementSibling
            : sibling.nextElementSibling;
      }
      return null;
    },

    // --- NEW: Master Chain Evaluation Function ---
    evaluateTabGroupState(tab) {
      if (this.isMovingMultiple) return;

      const prev = this.getValidSibling(tab, "prev");
      const next = this.getValidSibling(tab, "next");

      const getGroupOf = (el) => {
        if (!el) return null;
        if (el.classList && el.classList.contains("zen-custom-group-header"))
          return el.getAttribute("group-name");
        if (el.tagName && el.tagName.toLowerCase() === "tab")
          return el.getAttribute("zen-group");
        return null;
      };

      const prevGroup = getGroupOf(prev);
      const nextGroup = getGroupOf(next);

      if (prevGroup && prevGroup === nextGroup) {
        this.addTabToGroup(
          tab,
          prevGroup,
          prev.getAttribute("zen-color") || "grey",
        );
      } else if (prev && prev.classList.contains("zen-custom-group-header")) {
        const headerGroup = prev.getAttribute("group-name");
        this.addTabToGroup(
          tab,
          headerGroup,
          prev.getAttribute("zen-color") || "grey",
        );
      } else {
        this.removeTabFromGroup(tab);
      }
    },

    init() {
      this.buildContextMenu();
      this.buildHeaderMenu();
      this.restoreGroupsOnLoad();
      this.setupFolderDragAndDrop();

      gBrowser.tabContainer.addEventListener("TabClose", () => {
        setTimeout(() => this.cleanupEmptyGroups(), 10);
      });

      gBrowser.tabContainer.addEventListener("TabOpen", (e) => {
        setTimeout(() => {
          if (this.isMovingMultiple) return;

          const tab = e.target;
          if (!tab || tab.closing) return;

          const prev = this.getValidSibling(tab, "prev");
          const next = this.getValidSibling(tab, "next");

          if (prev && prev.classList.contains("zen-custom-group-header")) {
            gBrowser.tabContainer.insertBefore(tab, prev);
          } else if (
            prev &&
            next &&
            prev.tagName.toLowerCase() === "tab" &&
            next.tagName.toLowerCase() === "tab"
          ) {
            const prevGroup = prev.getAttribute("zen-group");
            const nextGroup = next.getAttribute("zen-group");
            if (prevGroup && prevGroup === nextGroup) {
              this.addTabToGroup(
                tab,
                prevGroup,
                prev.getAttribute("zen-color") || "grey",
              );
            }
          }
        }, 10);
      });

      gBrowser.tabContainer.addEventListener("TabMove", (e) => {
        this.evaluateTabGroupState(e.target);
        setTimeout(() => this.cleanupEmptyGroups(), 50);
      });

      // --- FIX: The "Invisible Index Swap" Listener ---
      // This catches tabs swapping places with headers when native indices don't change
      gBrowser.tabContainer.addEventListener("dragend", (e) => {
        if (
          e.target &&
          e.target.tagName &&
          e.target.tagName.toLowerCase() === "tab"
        ) {
          setTimeout(() => {
            this.evaluateTabGroupState(e.target);
            this.cleanupEmptyGroups();
          }, 50); // Tiny delay allows the native DOM drop to finish settling
        }
      });
    },

    detectTabColor(tab) {
      try {
        const url = new URL(tab.linkedBrowser.currentURI.spec);
        const host = url.hostname.replace("www.", "");

        const domainColors = {
          "youtube.com": "red",
          "netflix.com": "red",
          "pinterest.com": "red",
          "facebook.com": "blue",
          "twitter.com": "blue",
          "x.com": "blue",
          "linkedin.com": "blue",
          "google.com": "blue",
          "reddit.com": "orange",
          "amazon.com": "orange",
          "stackoverflow.com": "orange",
          "spotify.com": "green",
          "whatsapp.com": "green",
          "github.com": "grey",
          "discord.com": "purple",
          "twitch.tv": "purple",
          "yahoo.com": "purple",
          "instagram.com": "pink",
          "dribbble.com": "pink",
          "snapchat.com": "yellow",
          "imdb.com": "yellow",
        };

        for (let domain in domainColors) {
          if (host.includes(domain)) return domainColors[domain];
        }
      } catch (e) {}

      try {
        const icon = tab.querySelector(".tab-icon-image");
        if (icon && icon.complete && icon.naturalWidth > 0) {
          let canvas = document.createElement("canvas");
          canvas.width = icon.naturalWidth;
          canvas.height = icon.naturalHeight;
          let ctx = canvas.getContext("2d");
          ctx.drawImage(icon, 0, 0);
          let data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

          let r = 0,
            g = 0,
            b = 0,
            count = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 128) {
              r += data[i];
              g += data[i + 1];
              b += data[i + 2];
              count++;
            }
          }

          if (count > 0) {
            r = r / count;
            g = g / count;
            b = b / count;

            const palette = {
              blue: [113, 183, 255],
              red: [255, 113, 113],
              green: [113, 255, 137],
              yellow: [255, 215, 113],
              purple: [209, 113, 255],
              pink: [255, 113, 209],
              orange: [255, 180, 113],
              grey: [170, 170, 170],
            };

            let bestColor = "grey";
            let minDistance = Infinity;

            for (let c in palette) {
              let pc = palette[c];
              let dist =
                Math.pow(r - pc[0], 2) +
                Math.pow(g - pc[1], 2) +
                Math.pow(b - pc[2], 2);
              if (dist < minDistance) {
                minDistance = dist;
                bestColor = c;
              }
            }
            return bestColor;
          }
        }
      } catch (e) {}

      return "grey";
    },

    addTabToGroup(tab, groupName, color) {
      tab.setAttribute("zen-group", groupName);
      tab.setAttribute("zen-color", color);
      tab.removeAttribute("zen-hidden");
      if ("SessionStore" in window) {
        SessionStore.setCustomTabValue(tab, "zen-group", groupName);
        SessionStore.setCustomTabValue(tab, "zen-color", color);
      }
    },

    removeTabFromGroup(tab) {
      tab.removeAttribute("zen-group");
      tab.removeAttribute("zen-color");
      tab.removeAttribute("zen-hidden");
      if ("SessionStore" in window) {
        SessionStore.deleteCustomTabValue(tab, "zen-group");
        SessionStore.deleteCustomTabValue(tab, "zen-color");
      }
    },

    restoreGroupsOnLoad() {
      setTimeout(() => {
        gBrowser.tabs.forEach((tab) => this.checkAndRestoreTab(tab));
      }, 500);

      gBrowser.tabContainer.addEventListener("SSTabRestored", (e) => {
        this.checkAndRestoreTab(e.target);
      });
    },

    checkAndRestoreTab(tab) {
      if ("SessionStore" in window) {
        const group = SessionStore.getCustomTabValue(tab, "zen-group");
        const color = SessionStore.getCustomTabValue(tab, "zen-color");
        if (group) {
          tab.setAttribute("zen-group", group);
          tab.setAttribute("zen-color", color || "grey");
          tab.removeAttribute("zen-hidden");
          this.createGroupHeader(group, tab, color);
        }
      }
    },

    setupFolderDragAndDrop() {
      gBrowser.tabContainer.addEventListener(
        "dragover",
        (e) => {
          if (e.dataTransfer.types.includes("application/zen-folder")) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
          }
        },
        true,
      );

      gBrowser.tabContainer.addEventListener(
        "drop",
        (e) => {
          const groupName = e.dataTransfer.getData("application/zen-folder");
          if (!groupName) return;

          e.preventDefault();
          e.stopPropagation();

          const dropTarget = e.target.closest("tab, .zen-custom-group-header");
          if (!dropTarget) return;

          const tabsToMove = Array.from(
            gBrowser.tabContainer.querySelectorAll(
              `tab[zen-group="${groupName}"]`,
            ),
          );
          const headerToMove = document.querySelector(
            `.zen-custom-group-header[group-name="${groupName}"]`,
          );

          if (dropTarget === headerToMove || tabsToMove.includes(dropTarget))
            return;

          let dropIndex = gBrowser.tabs.length;
          if (dropTarget.tagName.toLowerCase() === "tab") {
            dropIndex = dropTarget._tPos;
          } else if (dropTarget.classList.contains("zen-custom-group-header")) {
            const targetGroupName = dropTarget.getAttribute("group-name");
            const firstTargetTab = gBrowser.tabContainer.querySelector(
              `tab[zen-group="${targetGroupName}"]`,
            );
            if (firstTargetTab) dropIndex = firstTargetTab._tPos;
          }

          this.isMovingMultiple = true;

          let currentIndex = dropIndex;
          tabsToMove.forEach((tab) => {
            gBrowser.moveTabTo(tab, currentIndex);
            currentIndex++;
          });

          gBrowser.tabContainer.insertBefore(headerToMove, tabsToMove[0]);

          setTimeout(() => {
            this.isMovingMultiple = false;
          }, 100);
        },
        true,
      );
    },

    cleanupEmptyGroups() {
      const headers = document.querySelectorAll(".zen-custom-group-header");
      headers.forEach((header) => {
        const groupName = header.getAttribute("group-name");
        const tabsInGroup = Array.from(
          gBrowser.tabContainer.querySelectorAll(
            `tab[zen-group="${groupName}"]`,
          ),
        ).filter((tab) => !tab.closing);

        if (tabsInGroup.length === 0) {
          header.remove();
        }
      });
    },

    buildHeaderMenu() {
      if (document.getElementById("zen-group-header-menu")) return;

      const popupSet = document.getElementById("mainPopupSet");
      if (!popupSet) return;

      const popup = document.createXULElement("menupopup");
      popup.id = "zen-group-header-menu";

      const colors = [
        "Grey",
        "Blue",
        "Red",
        "Green",
        "Yellow",
        "Purple",
        "Pink",
        "Orange",
      ];

      colors.forEach((color) => {
        const item = document.createXULElement("menuitem");
        item.setAttribute("label", color);

        item.addEventListener("command", (e) => {
          const colorLower = color.toLowerCase();
          const activePopup = document.getElementById("zen-group-header-menu");
          const header = activePopup.triggerNode;

          if (header && header.classList.contains("zen-custom-group-header")) {
            const groupName = header.getAttribute("group-name");
            header.setAttribute("zen-color", colorLower);

            const tabs = gBrowser.tabContainer.querySelectorAll(
              `tab[zen-group="${groupName}"]`,
            );
            tabs.forEach((tab) =>
              this.addTabToGroup(tab, groupName, colorLower),
            );
          }
        });
        popup.appendChild(item);
      });

      popup.appendChild(document.createXULElement("menuseparator"));

      const renameItem = document.createXULElement("menuitem");
      renameItem.setAttribute("label", "Rename Group");
      renameItem.addEventListener("command", () => {
        const activePopup = document.getElementById("zen-group-header-menu");
        const header = activePopup.triggerNode;
        if (header) {
          const oldGroupName = header.getAttribute("group-name");
          const newGroupName = prompt(
            "Enter a new name for this Tab Group:",
            oldGroupName,
          );

          if (
            newGroupName &&
            newGroupName.trim() !== "" &&
            newGroupName !== oldGroupName
          ) {
            header.setAttribute("group-name", newGroupName);
            const label = header.querySelector(".zen-custom-group-label");
            if (label) label.setAttribute("value", newGroupName);

            const tabs = gBrowser.tabContainer.querySelectorAll(
              `tab[zen-group="${oldGroupName}"]`,
            );
            tabs.forEach((tab) => {
              tab.setAttribute("zen-group", newGroupName);
              if ("SessionStore" in window) {
                SessionStore.setCustomTabValue(tab, "zen-group", newGroupName);
              }
            });
          }
        }
      });
      popup.appendChild(renameItem);

      const ungroupItem = document.createXULElement("menuitem");
      ungroupItem.setAttribute("label", "Ungroup All Tabs");
      ungroupItem.addEventListener("command", () => {
        const activePopup = document.getElementById("zen-group-header-menu");
        const header = activePopup.triggerNode;
        if (header) {
          const groupName = header.getAttribute("group-name");
          const tabs = gBrowser.tabContainer.querySelectorAll(
            `tab[zen-group="${groupName}"]`,
          );
          tabs.forEach((tab) => this.removeTabFromGroup(tab));
          this.cleanupEmptyGroups();
        }
      });
      popup.appendChild(ungroupItem);

      const closeItem = document.createXULElement("menuitem");
      closeItem.setAttribute("label", "Close Group");
      closeItem.addEventListener("command", () => {
        const activePopup = document.getElementById("zen-group-header-menu");
        const header = activePopup.triggerNode;
        if (header) {
          const groupName = header.getAttribute("group-name");
          const tabs = Array.from(
            gBrowser.tabContainer.querySelectorAll(
              `tab[zen-group="${groupName}"]`,
            ),
          );
          tabs.forEach((tab) => gBrowser.removeTab(tab));
          this.cleanupEmptyGroups();
        }
      });
      popup.appendChild(closeItem);

      popupSet.appendChild(popup);
    },

    createGroupHeader(groupName, referenceTab, initialColor = "grey") {
      if (
        document.querySelector(
          `.zen-custom-group-header[group-name="${groupName}"]`,
        )
      )
        return;

      const header = document.createXULElement("hbox");
      header.className = "zen-custom-group-header";
      header.setAttribute("group-name", groupName);
      header.setAttribute("zen-color", initialColor);
      header.setAttribute("context", "zen-group-header-menu");

      header.setAttribute("draggable", "true");
      header.addEventListener("dragstart", (e) => {
        const currentName = header.getAttribute("group-name");
        e.dataTransfer.setData("application/zen-folder", currentName);
        e.dataTransfer.setData("text/plain", currentName);
        e.dataTransfer.effectAllowed = "move";
      });

      const icon = document.createXULElement("div");
      icon.className = "zen-custom-group-icon";
      header.appendChild(icon);

      const label = document.createXULElement("label");
      label.className = "zen-custom-group-label";
      label.setAttribute("value", groupName);
      header.appendChild(label);

      header.addEventListener("click", (e) => {
        if (e.button === 2) return;

        const isCollapsed = header.getAttribute("zen-collapsed") === "true";
        header.setAttribute("zen-collapsed", !isCollapsed);

        const currentName = header.getAttribute("group-name");
        const tabs = gBrowser.tabContainer.querySelectorAll(
          `tab[zen-group="${currentName}"]`,
        );
        tabs.forEach((tab) => {
          if (!isCollapsed) {
            tab.setAttribute("zen-hidden", "true");
          } else {
            tab.removeAttribute("zen-hidden");
          }
        });
      });

      gBrowser.tabContainer.insertBefore(header, referenceTab);
    },

    buildContextMenu() {
      const contextMenu = document.getElementById("tabContextMenu");
      if (!contextMenu || document.getElementById("zen-mod-custom-group"))
        return;

      const menuItem = document.createXULElement("menuitem");
      menuItem.id = "zen-mod-custom-group";
      menuItem.setAttribute("label", "Add to tab group");

      menuItem.addEventListener("command", () => {
        const targetTab = TabContextMenu.contextTab || gBrowser.selectedTab;
        const tabsToGroup = targetTab.multiselected
          ? Array.from(gBrowser.selectedTabs)
          : [targetTab];

        let groupName = "New Group";
        try {
          const urlString = tabsToGroup[0].linkedBrowser.currentURI.spec;

          if (
            urlString.startsWith("about:") ||
            urlString.startsWith("chrome:") ||
            urlString.startsWith("moz-extension:")
          ) {
            groupName = "System";
          } else {
            let host = new URL(urlString).hostname.replace(/^www\./, "");
            let match = host.match(/([^.]+)\.[^.]+$/);
            let name = match ? match[1] : host;

            if (name) {
              groupName = name.charAt(0).toUpperCase() + name.slice(1);
            }
          }
        } catch (e) {
          console.error("[ZenTabGroups] Error extracting domain name:", e);
        }

        const autoColor = this.detectTabColor(tabsToGroup[0]);
        this.isMovingMultiple = true;

        let insertIndex = tabsToGroup[0]._tPos;

        tabsToGroup.forEach((tab) => {
          this.removeTabFromGroup(tab);
          gBrowser.moveTabTo(tab, insertIndex);
          this.addTabToGroup(tab, groupName, autoColor);
          insertIndex++;
        });

        this.createGroupHeader(groupName, tabsToGroup[0], autoColor);
        this.cleanupEmptyGroups();

        setTimeout(() => {
          this.isMovingMultiple = false;
        }, 100);
      });

      const removeMenuItem = document.createXULElement("menuitem");
      removeMenuItem.id = "zen-mod-remove-group";
      removeMenuItem.setAttribute("label", "Remove from Group");

      removeMenuItem.addEventListener("command", () => {
        const targetTab = TabContextMenu.contextTab || gBrowser.selectedTab;
        const tabsToGroup = targetTab.multiselected
          ? Array.from(gBrowser.selectedTabs)
          : [targetTab];

        tabsToGroup.forEach((tab) => {
          const currentGroup = tab.getAttribute("zen-group");
          this.removeTabFromGroup(tab);

          const remainingGroupTabs = Array.from(
            gBrowser.tabContainer.querySelectorAll(
              `tab[zen-group="${currentGroup}"]`,
            ),
          );
          if (remainingGroupTabs.length > 0) {
            const lastTab = remainingGroupTabs[remainingGroupTabs.length - 1];
            gBrowser.moveTabTo(tab, lastTab._tPos + 1);
          }
        });

        this.cleanupEmptyGroups();
      });

      const insertReference = document.getElementById("context_reloadTab");
      if (insertReference) {
        contextMenu.insertBefore(menuItem, insertReference);
        contextMenu.insertBefore(removeMenuItem, insertReference);
      } else {
        contextMenu.appendChild(menuItem);
        contextMenu.appendChild(removeMenuItem);
      }
    },
  };

  if (gBrowserInit.delayedStartupFinished) {
    ZenGroups.init();
  } else {
    let delayedListener = (subject, topic) => {
      if (topic === "browser-delayed-startup-finished" && subject === window) {
        Services.obs.removeObserver(delayedListener, topic);
        ZenGroups.init();
      }
    };
    Services.obs.addObserver(
      delayedListener,
      "browser-delayed-startup-finished",
    );
  }
})();
