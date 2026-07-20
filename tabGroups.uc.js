// ==UserScript==
// @name           Zen Tab Groups
// @version        1.31.0
// @description    Tabs whose stored zen-color drifted from their group's header (from an older session) now self-heal to match the header instead of rendering with a mismatched border color.
// @author         Rajb16
// @include        main
// @onlyonce
// ==/UserScript==

(function () {
  if (window.location.href !== "chrome://browser/content/browser.xhtml") return;

  const PREFS = {
    MAX_VISIBLE_TABS: "extensions.zen-tab-groups.max_visible_tabs",
  };

  const getPref = (prefName, type, fallback) => {
    try {
      const branch = Services.prefs.getBranch("");
      if (branch.prefHasUserValue(prefName)) {
        if (type === "int") return branch.getIntPref(prefName);
        if (type === "string") return branch.getStringPref(prefName);
        if (type === "bool") return branch.getBoolPref(prefName);
      }
    } catch (e) {}
    return fallback;
  };

  const ZenGroups = {
    isMovingMultiple: false,

    // Groups with more tabs than this show a "Show N more" toggle instead of
    // rendering every tab, so a huge group doesn't push everything else out
    // of view. Deliberately not a real nested scrollbox: tabs must stay flat
    // direct children of gBrowser.tabContainer for Firefox's own tab-switch/
    // drag/keyboard-nav bookkeeping to keep working. Read live (not cached)
    // so the preference takes effect without a restart.
    get MAX_VISIBLE_TABS() {
      return getPref(PREFS.MAX_VISIBLE_TABS, "int", 12);
    },

    // Groups are only unique within a workspace - two different workspaces can
    // have a group with the same name, so every group query must be scoped by
    // zen-workspace-id or tabs/actions can leak across workspaces.
    groupTabSelector(groupName, workspaceId) {
      const nameSel = `tab[zen-group="${CSS.escape(groupName)}"]`;
      return workspaceId
        ? `${nameSel}[zen-workspace-id="${CSS.escape(workspaceId)}"]`
        : nameSel;
    },

    groupHeaderSelector(groupName, workspaceId) {
      const nameSel = `.zen-custom-group-header[group-name="${CSS.escape(groupName)}"]`;
      return workspaceId
        ? `${nameSel}[zen-workspace-id="${CSS.escape(workspaceId)}"]`
        : nameSel;
    },

    overflowToggleSelector(groupName, workspaceId) {
      const nameSel = `.zen-group-overflow-toggle[group-name="${CSS.escape(groupName)}"]`;
      return workspaceId
        ? `${nameSel}[zen-workspace-id="${CSS.escape(workspaceId)}"]`
        : nameSel;
    },

    getValidSibling(el, direction, workspaceId) {
      let sibling =
        direction === "prev"
          ? el.previousElementSibling
          : el.nextElementSibling;
      while (sibling) {
        const matchesWorkspace =
          !workspaceId ||
          sibling.getAttribute?.("zen-workspace-id") === workspaceId;
        if (
          matchesWorkspace &&
          sibling.classList &&
          sibling.classList.contains("zen-custom-group-header")
        )
          return sibling;
        if (
          matchesWorkspace &&
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

      const workspaceId = tab.getAttribute("zen-workspace-id");
      const prev = this.getValidSibling(tab, "prev", workspaceId);
      const next = this.getValidSibling(tab, "next", workspaceId);

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

          const workspaceId = tab.getAttribute("zen-workspace-id");
          const prev = this.getValidSibling(tab, "prev", workspaceId);
          const next = this.getValidSibling(tab, "next", workspaceId);

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

    // Moves `tab` to sit immediately after the current last tab of the given
    // group (live-requeried from the DOM), or leaves it where it is if the
    // group has no other tabs yet. Shared by manual grouping and AI sorting
    // so both always land tabs next to their actual group.
    //
    // Uses direct DOM sibling insertion (Node.after) rather than
    // gBrowser.moveTabTo(tab, numericIndex). A numeric index computed from
    // one query goes stale the instant any OTHER tab in the same batch also
    // moves (or if the move itself isn't perfectly synchronous) - that was
    // the root cause behind several rounds of "tabs land in the wrong spot"
    // bugs, worse the larger the batch (e.g. AI-sorting ~50 tabs at once).
    // Placing a tab as a sibling of a specific element is correct the
    // instant it executes; there's no position number to go stale.
    insertTabAtGroupEnd(tab, groupName, workspaceId) {
      const currentGroupTabs = gBrowser.tabContainer.querySelectorAll(
        this.groupTabSelector(groupName, workspaceId),
      );
      const lastTab = currentGroupTabs[currentGroupTabs.length - 1];
      if (lastTab && lastTab !== tab) {
        lastTab.after(tab);
      }
    },

    // Self-heal a group whose tabs aren't all physically contiguous - e.g.
    // tabs stranded elsewhere by an older version of this mod's positioning
    // bugs, before insertTabAtGroupEnd existed. Any tab whose immediate
    // (same-workspace) predecessor isn't its own header or another tab of
    // the same group gets moved back to sit at the group's current end.
    reconcileGroupOrder(groupName, workspaceId) {
      const tabs = Array.from(
        gBrowser.tabContainer.querySelectorAll(
          this.groupTabSelector(groupName, workspaceId),
        ),
      ).filter((tab) => !tab.closing);

      for (let i = 1; i < tabs.length; i++) {
        const tab = tabs[i];
        const prev = this.getValidSibling(tab, "prev", workspaceId);
        const prevGroup = !prev
          ? null
          : prev.classList?.contains("zen-custom-group-header")
            ? prev.getAttribute("group-name")
            : prev.getAttribute("zen-group");

        if (prevGroup !== groupName) {
          this.insertTabAtGroupEnd(tab, groupName, workspaceId);
        }
      }
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
        this.cleanupEmptyGroups();
      }, 500);

      gBrowser.tabContainer.addEventListener("SSTabRestored", (e) => {
        this.checkAndRestoreTab(e.target);
        this.cleanupEmptyGroups();
      });
    },

    checkAndRestoreTab(tab) {
      if (!("SessionStore" in window)) return;
      const group = SessionStore.getCustomTabValue(tab, "zen-group");
      const storedColor = SessionStore.getCustomTabValue(tab, "zen-color");
      if (!group) return;

      const workspaceId = tab.getAttribute("zen-workspace-id");
      let header = document.querySelector(
        this.groupHeaderSelector(group, workspaceId),
      );

      // If the header already exists this session, its color is the
      // group's single source of truth - use that instead of this tab's
      // own stored value. Without this, a tab restored with an older/
      // different stored zen-color (e.g. from before the group was last
      // recolored) permanently renders with a mismatched border/glow
      // color, since nothing else ever re-syncs it against the header.
      const color = header
        ? header.getAttribute("zen-color") || "grey"
        : storedColor || "grey";

      tab.setAttribute("zen-group", group);
      tab.setAttribute("zen-color", color);
      SessionStore.setCustomTabValue(tab, "zen-color", color);

      if (!header) {
        // First time this group is seen this session (e.g. browser startup):
        // start it collapsed rather than expanded.
        header = this.createGroupHeader(group, tab, color, true);
      }

      const isCollapsed = header?.getAttribute("zen-collapsed") === "true";
      if (isCollapsed) {
        tab.setAttribute("zen-hidden", "true");
      } else {
        tab.removeAttribute("zen-hidden");
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

          const workspaceId = dropTarget.getAttribute("zen-workspace-id");
          const tabsToMove = Array.from(
            gBrowser.tabContainer.querySelectorAll(
              this.groupTabSelector(groupName, workspaceId),
            ),
          );
          const headerToMove = document.querySelector(
            this.groupHeaderSelector(groupName, workspaceId),
          );

          if (dropTarget === headerToMove || tabsToMove.includes(dropTarget))
            return;

          // Insert the whole [header, tab1..tabN] block directly before this
          // node (DOM sibling insertion, not a numeric index - see
          // insertTabAtGroupEnd for why numeric indices go stale mid-batch).
          let referenceNode = null;
          if (dropTarget.tagName.toLowerCase() === "tab") {
            referenceNode = dropTarget;
          } else if (dropTarget.classList.contains("zen-custom-group-header")) {
            const targetGroupName = dropTarget.getAttribute("group-name");
            referenceNode = gBrowser.tabContainer.querySelector(
              this.groupTabSelector(targetGroupName, workspaceId),
            );
          }

          this.isMovingMultiple = true;

          if (referenceNode) {
            referenceNode.before(headerToMove);
          } else {
            gBrowser.tabContainer.appendChild(headerToMove);
          }

          let anchor = headerToMove;
          tabsToMove.forEach((tab) => {
            anchor.after(tab);
            anchor = tab;
          });

          setTimeout(() => {
            this.isMovingMultiple = false;
          }, 100);
        },
        true,
      );
    },

    cleanupEmptyGroups() {
      const wasMoving = this.isMovingMultiple;
      this.isMovingMultiple = true;
      try {
        const headers = document.querySelectorAll(".zen-custom-group-header");
        headers.forEach((header) => {
          // Isolated per-group: one group throwing (e.g. a transient _tPos
          // issue mid session-restore) must not abort reconciliation for
          // every other group processed after it in this same pass.
          try {
            const groupName = header.getAttribute("group-name");
            const workspaceId = header.getAttribute("zen-workspace-id");

            this.reconcileGroupOrder(groupName, workspaceId);

            const tabsInGroup = Array.from(
              gBrowser.tabContainer.querySelectorAll(
                this.groupTabSelector(groupName, workspaceId),
              ),
            ).filter((tab) => !tab.closing);

            if (tabsInGroup.length === 0) {
              header.remove();
              const toggle = document.querySelector(
                this.overflowToggleSelector(groupName, workspaceId),
              );
              if (toggle) toggle.remove();
            } else {
              // Self-heal any tab whose zen-color drifted from its
              // header (e.g. restored from an older session before the
              // group was last recolored) - the header is always this
              // group's source of truth.
              const headerColor = header.getAttribute("zen-color") || "grey";
              tabsInGroup.forEach((tab) => {
                if (tab.getAttribute("zen-color") !== headerColor) {
                  this.addTabToGroup(tab, groupName, headerColor);
                }
              });

              this.updateGroupOverflow(header, tabsInGroup);
            }
          } catch (e) {
            console.error(
              "[ZenTabGroups] Error cleaning up group:",
              header.getAttribute("group-name"),
              e,
            );
          }
        });
      } finally {
        this.isMovingMultiple = wasMoving;
      }
    },

    // Caps how many of a group's tabs are actually shown, hiding the rest
    // behind a "Show N more" toggle instead of a nested scrollbox (see
    // MAX_VISIBLE_TABS). Re-run any time group membership could have
    // changed, so it always reflects the live tab list.
    updateGroupOverflow(header, tabsInGroup) {
      const groupName = header.getAttribute("group-name");
      const workspaceId = header.getAttribute("zen-workspace-id");
      const expanded = header.getAttribute("zen-overflow-expanded") === "true";
      const overflowCount = tabsInGroup.length - this.MAX_VISIBLE_TABS;
      const shouldCap = !expanded && overflowCount > 0;

      tabsInGroup.forEach((tab, i) => {
        if (shouldCap && i >= this.MAX_VISIBLE_TABS) {
          tab.setAttribute("zen-overflow-hidden", "true");
        } else {
          tab.removeAttribute("zen-overflow-hidden");
        }
      });

      this.ensureOverflowToggle(
        header,
        tabsInGroup,
        overflowCount,
        expanded,
        groupName,
        workspaceId,
      );
    },

    ensureOverflowToggle(
      header,
      tabsInGroup,
      overflowCount,
      expanded,
      groupName,
      workspaceId,
    ) {
      let toggle = document.querySelector(
        this.overflowToggleSelector(groupName, workspaceId),
      );

      if (overflowCount <= 0) {
        if (toggle) toggle.remove();
        return;
      }

      if (!toggle) {
        toggle = document.createXULElement("hbox");
        toggle.className = "zen-group-overflow-toggle";
        toggle.setAttribute("group-name", groupName);
        if (workspaceId) toggle.setAttribute("zen-workspace-id", workspaceId);

        const label = document.createXULElement("label");
        label.className = "zen-group-overflow-label";
        toggle.appendChild(label);

        toggle.addEventListener("click", () => {
          const isExpanded =
            header.getAttribute("zen-overflow-expanded") === "true";
          header.setAttribute(
            "zen-overflow-expanded",
            isExpanded ? "false" : "true",
          );
          const currentTabs = Array.from(
            gBrowser.tabContainer.querySelectorAll(
              this.groupTabSelector(groupName, workspaceId),
            ),
          );
          this.updateGroupOverflow(header, currentTabs);
        });
      }

      const isHeaderCollapsed =
        header.getAttribute("zen-collapsed") === "true";
      toggle.setAttribute("zen-collapsed", isHeaderCollapsed ? "true" : "false");
      toggle.setAttribute("zen-color", header.getAttribute("zen-color") || "grey");

      const label = toggle.querySelector(".zen-group-overflow-label");
      label.setAttribute(
        "value",
        expanded ? "Show less" : `Show ${overflowCount} more`,
      );

      const lastVisibleTab = expanded
        ? tabsInGroup[tabsInGroup.length - 1]
        : tabsInGroup[this.MAX_VISIBLE_TABS - 1];
      if (lastVisibleTab) lastVisibleTab.after(toggle);
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
          // triggerNode is whatever element the right-click actually landed
          // on (e.g. the icon or label), not necessarily the header itself.
          const header = activePopup.triggerNode?.closest(
            ".zen-custom-group-header",
          );

          if (header && header.classList.contains("zen-custom-group-header")) {
            const groupName = header.getAttribute("group-name");
            const workspaceId = header.getAttribute("zen-workspace-id");
            header.setAttribute("zen-color", colorLower);

            const tabs = gBrowser.tabContainer.querySelectorAll(
              this.groupTabSelector(groupName, workspaceId),
            );
            tabs.forEach((tab) =>
              this.addTabToGroup(tab, groupName, colorLower),
            );
            this.cleanupEmptyGroups();
          }
        });
        popup.appendChild(item);
      });

      popup.appendChild(document.createXULElement("menuseparator"));

      const renameItem = document.createXULElement("menuitem");
      renameItem.setAttribute("label", "Rename Group");
      renameItem.addEventListener("command", () => {
        const activePopup = document.getElementById("zen-group-header-menu");
        // triggerNode is whatever element the right-click actually landed
        // on (e.g. the icon or label), not necessarily the header itself.
        const header = activePopup.triggerNode?.closest(
          ".zen-custom-group-header",
        );
        if (header) {
          const oldGroupName = header.getAttribute("group-name");
          const workspaceId = header.getAttribute("zen-workspace-id");
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
              this.groupTabSelector(oldGroupName, workspaceId),
            );
            tabs.forEach((tab) => {
              tab.setAttribute("zen-group", newGroupName);
              if ("SessionStore" in window) {
                SessionStore.setCustomTabValue(tab, "zen-group", newGroupName);
              }
            });

            // The overflow toggle (if any) still carries the old name as an
            // attribute and its click handler closes over it - drop it so
            // cleanupEmptyGroups rebuilds a correctly-named one.
            const oldToggle = document.querySelector(
              this.overflowToggleSelector(oldGroupName, workspaceId),
            );
            if (oldToggle) oldToggle.remove();
            this.cleanupEmptyGroups();
          }
        }
      });
      popup.appendChild(renameItem);

      const ungroupItem = document.createXULElement("menuitem");
      ungroupItem.setAttribute("label", "Ungroup All Tabs");
      ungroupItem.addEventListener("command", () => {
        const activePopup = document.getElementById("zen-group-header-menu");
        // triggerNode is whatever element the right-click actually landed
        // on (e.g. the icon or label), not necessarily the header itself.
        const header = activePopup.triggerNode?.closest(
          ".zen-custom-group-header",
        );
        if (header) {
          const groupName = header.getAttribute("group-name");
          const workspaceId = header.getAttribute("zen-workspace-id");
          const tabs = gBrowser.tabContainer.querySelectorAll(
            this.groupTabSelector(groupName, workspaceId),
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
        // triggerNode is whatever element the right-click actually landed
        // on (e.g. the icon or label), not necessarily the header itself.
        const header = activePopup.triggerNode?.closest(
          ".zen-custom-group-header",
        );
        if (header) {
          const groupName = header.getAttribute("group-name");
          const workspaceId = header.getAttribute("zen-workspace-id");
          const tabs = Array.from(
            gBrowser.tabContainer.querySelectorAll(
              this.groupTabSelector(groupName, workspaceId),
            ),
          );
          tabs.forEach((tab) => gBrowser.removeTab(tab));
          this.cleanupEmptyGroups();
        }
      });
      popup.appendChild(closeItem);

      popupSet.appendChild(popup);
    },

    createGroupHeader(
      groupName,
      referenceTab,
      initialColor = "grey",
      startCollapsed = false,
    ) {
      const workspaceId = referenceTab.getAttribute("zen-workspace-id");
      const existing = document.querySelector(
        this.groupHeaderSelector(groupName, workspaceId),
      );
      if (existing) return existing;

      const header = document.createXULElement("hbox");
      header.className = "zen-custom-group-header";
      header.setAttribute("group-name", groupName);
      header.setAttribute("zen-color", initialColor);
      header.setAttribute("zen-collapsed", startCollapsed ? "true" : "false");
      header.setAttribute("context", "zen-group-header-menu");
      if (workspaceId) {
        header.setAttribute("zen-workspace-id", workspaceId);
      }

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
        const nowCollapsed = !isCollapsed;
        header.setAttribute("zen-collapsed", nowCollapsed);

        const currentName = header.getAttribute("group-name");
        const currentWorkspaceId = header.getAttribute("zen-workspace-id");
        const tabs = gBrowser.tabContainer.querySelectorAll(
          this.groupTabSelector(currentName, currentWorkspaceId),
        );
        tabs.forEach((tab) => {
          if (!isCollapsed) {
            tab.setAttribute("zen-hidden", "true");
          } else {
            tab.removeAttribute("zen-hidden");
          }
        });

        const toggle = document.querySelector(
          this.overflowToggleSelector(currentName, currentWorkspaceId),
        );
        if (toggle) {
          toggle.setAttribute("zen-collapsed", nowCollapsed ? "true" : "false");
        }
      });

      gBrowser.tabContainer.insertBefore(header, referenceTab);
      return header;
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

        const workspaceId = tabsToGroup[0].getAttribute("zen-workspace-id");
        const existingHeader = document.querySelector(
          this.groupHeaderSelector(groupName, workspaceId),
        );
        const autoColor = existingHeader
          ? existingHeader.getAttribute("zen-color") || "grey"
          : this.detectTabColor(tabsToGroup[0]);

        this.isMovingMultiple = true;

        if (existingHeader) {
          // Group already exists elsewhere - place every tab next to it
          // instead of leaving them wherever they currently sit.
          tabsToGroup.forEach((tab) => {
            this.removeTabFromGroup(tab);
            this.insertTabAtGroupEnd(tab, groupName, workspaceId);
            this.addTabToGroup(tab, groupName, autoColor);
          });
        } else {
          const [firstTab, ...restTabs] = tabsToGroup;
          this.removeTabFromGroup(firstTab);
          this.addTabToGroup(firstTab, groupName, autoColor);
          this.createGroupHeader(groupName, firstTab, autoColor);

          restTabs.forEach((tab) => {
            this.removeTabFromGroup(tab);
            this.insertTabAtGroupEnd(tab, groupName, workspaceId);
            this.addTabToGroup(tab, groupName, autoColor);
          });
        }

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
          const workspaceId = tab.getAttribute("zen-workspace-id");
          this.removeTabFromGroup(tab);

          const remainingGroupTabs = Array.from(
            gBrowser.tabContainer.querySelectorAll(
              this.groupTabSelector(currentGroup, workspaceId),
            ),
          );
          if (remainingGroupTabs.length > 0) {
            const lastTab = remainingGroupTabs[remainingGroupTabs.length - 1];
            lastTab.after(tab);
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
    window.ZenCustomGroups = ZenGroups; // <-- Added
    ZenGroups.init();
  } else {
    let delayedListener = (subject, topic) => {
      if (topic === "browser-delayed-startup-finished" && subject === window) {
        Services.obs.removeObserver(delayedListener, topic);
        window.ZenCustomGroups = ZenGroups; // <-- Added
        ZenGroups.init();
      }
    };
    Services.obs.addObserver(
      delayedListener,
      "browser-delayed-startup-finished",
    );
  }
})();
