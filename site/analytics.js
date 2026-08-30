/* global URL, URLSearchParams, document, navigator, window */

(function initializeMarketingAnalytics() {
  "use strict";

  const productionHostname = "arts-link.github.io";
  const productionPath = "/screenshot-a-day/";
  const projectToken = "phc_xVRUsAdDgvdQM2MxmSLMZqQaTKvnb83xCAQj3Ydy7yw6";
  const apiHost = "https://g.arts-link.com";
  const allowedEvents = new Set(["$pageview", "marketing_cta_clicked", "install_command_copied"]);
  const campaignKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content"];

  if (
    window.location.hostname !== productionHostname ||
    !window.location.pathname.startsWith(productionPath) ||
    navigator.doNotTrack === "1" ||
    navigator.globalPrivacyControl === true
  ) {
    return;
  }

  function cleanUrl(value, originOnly = false) {
    if (!value) return value;

    try {
      const url = new URL(value, window.location.origin);
      return originOnly ? url.origin : `${url.origin}${url.pathname}`;
    } catch {
      return undefined;
    }
  }

  function campaignProperties() {
    const search = new URLSearchParams(window.location.search);
    const properties = {};

    for (const key of campaignKeys) {
      const value = search.get(key)?.trim();
      if (value && /^[a-zA-Z0-9._-]{1,80}$/.test(value)) properties[`$${key}`] = value;
    }

    return properties;
  }

  function sanitizeEvent(event) {
    if (!event || !allowedEvents.has(event.event)) return null;

    const properties = event.properties || {};
    const urlKeys = ["$current_url", "$initial_current_url", "current_url"];
    const referrerKeys = ["$referrer", "$initial_referrer"];

    for (const key of urlKeys) {
      if (key in properties) properties[key] = cleanUrl(properties[key]);
    }
    for (const key of referrerKeys) {
      if (key in properties) properties[key] = cleanUrl(properties[key], true);
    }
    for (const key of campaignKeys) delete properties[`$${key}`];

    Object.assign(properties, campaignProperties());
    event.properties = properties;
    return event;
  }

  // PostHog's public browser loader. The project token identifies the ingestion
  // destination; it is not a private API credential.
  function loadPostHog(documentObject, posthog) {
    let firstScript;
    let index;
    let method;
    let script;

    if (posthog.__SV) return;
    window.posthog = posthog;
    posthog._i = [];
    posthog.init = function init(token, config, name) {
      function stub(target, path) {
        const parts = path.split(".");
        if (parts.length === 2) {
          target = target[parts[0]];
          path = parts[1];
        }
        target[path] = function queueCall() {
          target.push([path, ...arguments]);
        };
      }

      script = documentObject.createElement("script");
      script.type = "text/javascript";
      script.crossOrigin = "anonymous";
      script.async = true;
      script.src = `${config.api_host}/static/1/array.js`;
      firstScript = documentObject.getElementsByTagName("script")[0];
      firstScript.parentNode.insertBefore(script, firstScript);

      let instance = posthog;
      if (name !== undefined) instance = posthog[name] = [];
      else name = "posthog";
      instance.people = instance.people || [];
      instance.toString = function toString(detail) {
        let label = "posthog";
        if (name !== "posthog") label += `.${name}`;
        return detail ? `${label} (stub)` : label;
      };
      instance.people.toString = function peopleToString() {
        return `${instance.toString(1)}.people (stub)`;
      };

      method =
        "init capture register register_once unregister getFeatureFlag getFeatureFlagPayload isFeatureEnabled identify group reset opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing set_config debug".split(
          " ",
        );
      for (index = 0; index < method.length; index += 1) stub(instance, method[index]);
      posthog._i.push([token, config, name]);
    };
    posthog.__SV = 1;
  }

  loadPostHog(document, window.posthog || []);

  window.posthog.init(projectToken, {
    api_host: apiHost,
    ui_host: "https://us.posthog.com",
    defaults: "2026-05-30",
    cookieless_mode: "always",
    person_profiles: "never",
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_heatmaps: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    advanced_disable_flags: true,
    respect_dnt: true,
    before_send: sanitizeEvent,
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("[data-analytics-destination]");
    if (!link) return;

    window.posthog.capture("marketing_cta_clicked", {
      destination: link.dataset.analyticsDestination,
      placement: link.dataset.analyticsPlacement,
      release: "0.1.0",
    });
  });

  document.addEventListener("sad:install-command-copied", () => {
    window.posthog.capture("install_command_copied", {
      placement: "quick-start",
      release: "0.1.0",
    });
  });
})();
