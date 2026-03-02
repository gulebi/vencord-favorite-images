/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin from "@utils/types";
import { createRoot, ExpressionPickerStore, Menu, Toasts, useCallback, useEffect, useState } from "@webpack/common";

import managedStyle from "./styles.css?managed";

// ─── Favorite Images Data Management ───

const STORE_KEY = "FavoriteImages";
let favoriteUrls = new Set<string>();

interface FavoriteImage {
    url: string;
    addedAt: number;
}

async function getFavorites(): Promise<FavoriteImage[]> {
    return (await DataStore.get<FavoriteImage[]>(STORE_KEY)) ?? [];
}

async function addFavorite(url: string): Promise<void> {
    const favs = await getFavorites();
    if (favs.some(f => f.url === url)) return;
    favs.unshift({ url, addedAt: Date.now() });
    await DataStore.set(STORE_KEY, favs);
    favoriteUrls.add(url);
}

async function removeFavorite(url: string): Promise<void> {
    const favs = await getFavorites();
    await DataStore.set(STORE_KEY, favs.filter(f => f.url !== url));
    favoriteUrls.delete(url);
}

function isFavorite(url: string): boolean {
    return favoriteUrls.has(url);
}

async function refreshFavoriteCache(): Promise<void> {
    favoriteUrls = new Set((await getFavorites()).map(f => f.url));
}

// ─── Favorite Images Panel (rendered inside expression picker) ───

function FavoriteImagesPanel() {
    const [favorites, setFavorites] = useState<FavoriteImage[]>([]);
    const [loading, setLoading] = useState(true);

    const loadFavorites = useCallback(async () => {
        const favs = await getFavorites();
        setFavorites(favs);
        setLoading(false);
    }, []);

    useEffect(() => {
        loadFavorites();
    }, [loadFavorites]);

    const handleRemove = useCallback(async (url: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await removeFavorite(url);
        setFavorites(prev => prev.filter(f => f.url !== url));
        Toasts.show({
            message: "Removed from favorites",
            id: Toasts.genId(),
            type: Toasts.Type.SUCCESS,
        });
    }, []);

    const handleSend = useCallback((url: string) => {
        insertTextIntoChatInputBox(url + " ");
        ExpressionPickerStore.closeExpressionPicker();
    }, []);

    if (loading) {
        return (
            <div className="vc-fav-images-empty">
                <span>Loading...</span>
            </div>
        );
    }

    if (favorites.length === 0) {
        return (
            <div className="vc-fav-images-empty">
                <HeartIcon width={48} height={48} />
                <span>No favorite images yet</span>
                <span style={{ fontSize: "12px" }}>Right-click on an image and select "Add to Favorites"</span>
            </div>
        );
    }

    return (
        <>
            <div className="vc-fav-images-header">
                <div className="vc-fav-images-header-inner">
                    <h3 className="vc-fav-images-header-text">Favorites</h3>
                </div>
            </div>
            <div className="vc-fav-images-content">
                <div className="vc-fav-images-grid">
                    {favorites.map(fav => (
                        <div
                            key={fav.url}
                            className="vc-fav-images-grid-item"
                            onClick={() => handleSend(fav.url)}
                        >
                            <img
                                src={fav.url}
                                alt="Favorite image"
                                loading="lazy"
                            />
                            <button
                                className="vc-fav-images-remove-btn"
                                onClick={e => handleRemove(fav.url, e)}
                                aria-label="Remove from favorites"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}

// ─── Heart Icon SVG ───

function HeartIcon({ width = 24, height = 24, filled = false }: { width?: number; height?: number; filled?: boolean; }) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
    );
}

// ─── Context Menu Patches ───

function buildMenuItem(src: string) {
    const isFav = isFavorite(src);

    return (
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-fav-image-toggle"
                label={isFav ? "Remove from Favorites" : "Add to Favorites"}
                icon={() => <HeartIcon width={20} height={20} filled={isFav} />}
                action={async () => {
                    if (isFav) {
                        await removeFavorite(src);
                        Toasts.show({
                            message: "Removed from favorites",
                            id: Toasts.genId(),
                            type: Toasts.Type.SUCCESS,
                        });
                    } else {
                        await addFavorite(src);
                        Toasts.show({
                            message: "Added to favorites!",
                            id: Toasts.genId(),
                            type: Toasts.Type.SUCCESS,
                        });
                    }
                }}
            />
        </Menu.MenuGroup>
    );
}

const imageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!props?.src) return;

    const { src } = props;

    children.push(
        buildMenuItem(src)
    );
};

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    // For message context menus with image data
    if (!props?.itemSrc && !props?.itemHref) return;

    const src = props.itemHref ?? props.itemSrc;
    if (!src || !isImageUrl(src)) return;

    children.push(
        buildMenuItem(src)
    );
};

function isImageUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        const path = parsed.pathname.toLowerCase();
        return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(path) ||
            parsed.host.includes("media.discordapp") ||
            parsed.host.includes("cdn.discordapp");
    } catch {
        return false;
    }
}

// ─── Expression Picker Tab Injection ───

let observer: MutationObserver | null = null;
let panelRoot: ReturnType<typeof createRoot> | null = null;

function injectNavButton() {
    const nav = document.querySelector('[class*="navList_"]');
    if (!nav) return;
    if (nav.querySelector(".vc-fav-images-nav-btn")) return;

    const btn = document.createElement("div");
    btn.className = "vc-fav-images-nav-btn";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", "false");
    btn.setAttribute("tabindex", "0");
    btn.textContent = "Images";

    btn.addEventListener("click", () => {
        // Deselect other tabs
        nav.querySelectorAll("[role='tab']").forEach(tab => {
            tab.setAttribute("aria-selected", "false");
            // Remove Discord's selected styling
            tab.classList.forEach(cls => {
                if (cls.includes("navButtonActive_")) {
                    tab.classList.replace(cls, cls + "-inactive");
                }
            });
        });
        btn.setAttribute("aria-selected", "true");

        // Show our custom panel
        showFavoritesPanel();
    });

    // When any other tab is clicked, restore state
    nav.querySelectorAll("[role='tab']").forEach(tab => {
        if (tab === btn) return;
        tab.addEventListener("click", () => {
            btn.setAttribute("aria-selected", "false");
            tab.classList.forEach(cls => {
                if (cls.includes("-inactive")) {
                    tab.classList.replace(cls, cls.replace("-inactive", ""));
                }
            });
            hideFavoritesPanel();
        });
    });

    nav.appendChild(btn);
}

function showFavoritesPanel() {
    // Hide the existing picker content
    const pickerContent = document.querySelector('[id*="-picker-tab-panel"]');
    if (pickerContent) {
        (pickerContent as HTMLElement).style.display = "none";
    }

    // Check if panel already exists in the DOM
    let panel = document.querySelector("#vc-fav-images-tab-panel");
    if (!panel) {
        // Previous root is stale if the DOM was destroyed (picker closed)
        if (panelRoot) {
            try { panelRoot.unmount(); } catch { }
            panelRoot = null;
        }

        panel = document.createElement("div");
        panel.id = "vc-fav-images-tab-panel";
        panel.className = "vc-fav-images-panel-container";

        // Insert after the nav
        const contentWrapper = document.querySelector('[class*="contentWrapper_"]');
        const nav = contentWrapper?.querySelector('[class*="nav_"]');

        if (contentWrapper && nav) {
            contentWrapper.appendChild(panel);
        }
    }

    (panel as HTMLElement).style.display = "flex";

    // Use React to render the panel
    if (!panelRoot) {
        panelRoot = createRoot(panel as HTMLElement);
    }
    panelRoot.render(<FavoriteImagesPanel />);
}

function hideFavoritesPanel() {
    // Show the existing picker content
    const pickerContent = document.querySelector('[id*="-picker-tab-panel"]');
    if (pickerContent) {
        (pickerContent as HTMLElement).style.display = "";
    }

    // Hide our panel
    const panel = document.querySelector("#vc-fav-images-tab-panel");
    if (panel) {
        (panel as HTMLElement).style.display = "none";
    }
}

// ─── Mutation Observer ───

function startObserver() {
    observer = new MutationObserver(() => {
        injectNavButton();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
}

function stopObserver() {
    observer?.disconnect();
    observer = null;

    const pickerContent = document.querySelector('[id*="-picker-tab-panel"]');
    if (pickerContent) {
        (pickerContent as HTMLElement).style.display = "";
    }

    // Clean up DOM
    document.querySelector("#vc-fav-images-tab-panel")?.remove();
    document.querySelectorAll(".vc-fav-images-nav-btn").forEach(el => el.remove());

    if (panelRoot) {
        panelRoot.unmount();
        panelRoot = null;
    }
}

// ─── Plugin Definition ───

export default definePlugin({
    name: "FavoriteImages",
    description: "Allows users to favorite images in Discord and view them in the expression picker",
    authors: [{ name: "gulebi", id: 546703392081313793n }],

    managedStyle,

    contextMenus: {
        "image-context": imageContextMenuPatch,
        "message": messageContextMenuPatch,
    },

    start() {
        void refreshFavoriteCache();
        startObserver();
    },

    stop() {
        stopObserver();
    },
});

