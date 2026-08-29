// Package mojang is the one client for Mojang's public account APIs (name → UUID, profile textures).
package mojang

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// ErrNotFound means no Mojang account has that name / id.
var ErrNotFound = errors.New("not found on Mojang")

type Client struct {
	http *http.Client
	ua   string
}

func New(userAgent string) *Client {
	return &Client{http: &http.Client{Timeout: 10 * time.Second}, ua: userAgent}
}

// ProfileID resolves a player name to the account's UUID (undashed hex).
func (c *Client) ProfileID(ctx context.Context, name string) (string, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := c.getJSON(ctx, "https://api.mojang.com/users/profiles/minecraft/"+name, &body); err != nil {
		return "", err
	}
	if body.ID == "" {
		return "", ErrNotFound
	}
	return body.ID, nil
}

// SkinURL returns the skin texture URL of a profile, or ErrNotFound when it has no custom skin.
func (c *Client) SkinURL(ctx context.Context, id string) (string, error) {
	var session struct {
		Properties []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		} `json:"properties"`
	}
	if err := c.getJSON(ctx, "https://sessionserver.mojang.com/session/minecraft/profile/"+id, &session); err != nil {
		return "", err
	}
	for _, p := range session.Properties {
		if p.Name != "textures" {
			continue
		}
		raw, err := base64.StdEncoding.DecodeString(p.Value)
		if err != nil {
			return "", err
		}
		var tex struct {
			Textures struct {
				Skin struct {
					URL string `json:"url"`
				} `json:"SKIN"`
			} `json:"textures"`
		}
		if err := json.Unmarshal(raw, &tex); err != nil {
			return "", err
		}
		u := tex.Textures.Skin.URL
		if strings.HasPrefix(u, "http://textures.minecraft.net/") || strings.HasPrefix(u, "https://textures.minecraft.net/") {
			return u, nil
		}
	}
	return "", ErrNotFound
}

// Get performs a GET with the client's User-Agent; 404/204 map to ErrNotFound. Callers close the body.
func (c *Client) Get(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", c.ua)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mojang: %w", err)
	}
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusNoContent:
		resp.Body.Close()
		return nil, ErrNotFound
	case resp.StatusCode != http.StatusOK:
		resp.Body.Close()
		return nil, fmt.Errorf("mojang: GET %s: %s", url, resp.Status)
	}
	return resp, nil
}

func (c *Client) getJSON(ctx context.Context, url string, v any) error {
	resp, err := c.Get(ctx, url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(v)
}
