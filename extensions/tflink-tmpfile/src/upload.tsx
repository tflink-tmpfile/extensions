import React from "react";
import {
  Clipboard,
  Detail,
  ActionPanel,
  Action,
  showToast,
  Toast,
  Icon,
} from "@raycast/api";
import { useEffect, useState, useCallback, useRef } from "react";
import fs from "fs";
import path from "path";

export default function Command() {
  const [isLoading, setIsLoading] = useState(true);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [downloadLink, setDownloadLink] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("Initializing...");

  // Timer ref
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Format bytes to human readable string
  const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const startTimer = () => {
    setElapsedTime(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedTime((prev: number) => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const uploadFromClipboard = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    setDownloadLink(null);
    setElapsedTime(0);
    startTimer();

    try {
      setStatusText("Checking clipboard...");
      if (signal?.aborted) return;

      const clipboardContents = await Clipboard.read();
      if (signal?.aborted) return;

      const formData = new FormData();
      let name = "";
      let sizeDisplay = "";

      if (clipboardContents.file) {
        const filePath = decodeURIComponent(
          clipboardContents.file.replace("file://", ""),
        );
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory())
            throw new Error(
              "Directory upload not supported. Please zip it first.",
            );
          if (stats.size > 100 * 1024 * 1024)
            throw new Error("File exceeds 100MB limit.");

          name = path.basename(filePath);
          setFileName(name);
          sizeDisplay = formatBytes(stats.size);
          setFileSize(sizeDisplay);
          setStatusText(`Uploading "${name}"...`);

          const fileBuffer = fs.readFileSync(filePath);
          formData.append("file", new Blob([new Uint8Array(fileBuffer)]), name);
        }
      } else if (
        clipboardContents.text &&
        clipboardContents.text.trim() !== ""
      ) {
        name = `snippet_${new Date().getTime()}.txt`;
        setFileName(name);
        const size = new Blob([clipboardContents.text]).size;
        sizeDisplay = formatBytes(size);
        setFileSize(sizeDisplay);

        setStatusText("Uploading text snippet...");
        formData.append(
          "file",
          new Blob([clipboardContents.text], { type: "text/plain" }),
          name,
        );
      } else {
        throw new Error("Clipboard is empty or does not contain text/files.");
      }

      const response = await fetch("https://tmpfile.link/api/upload", {
        method: "POST",
        body: formData,
        signal: signal, // Pass the abort signal to fetch
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(
          `Upload failed (${response.status}): ${err || "Unknown error"}`,
        );
      }

      const result = (await response.json()) as {
        downloadLink: string;
        downloadLinkEncoded?: string;
      };

      if (signal?.aborted) return; // Last check before updating state

      // Use the server-provided encoded link if available, otherwise fallback to the raw link
      const finalLink = result.downloadLinkEncoded || result.downloadLink;

      setDownloadLink(finalLink);
      await Clipboard.copy(finalLink);
      await showToast({
        style: Toast.Style.Success,
        title: "Uploaded & Copied!",
      });
      setStatusText("Successfully Uploaded!");
    } catch (err) {
      if (
        signal?.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        // Ignore abort errors
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatusText("Failed");
      showToast({
        style: Toast.Style.Failure,
        title: "Upload Failed",
        message: msg,
      });
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
        stopTimer();
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    uploadFromClipboard(controller.signal);

    return () => {
      controller.abort();
      stopTimer(); // Also ensure timer is stopped on unmount
    };
  }, [uploadFromClipboard]);

  // -- Markdown Generation --
  const getMarkdown = () => {
    const timeDisplay = `${elapsedTime}s`;

    if (error) {
      return `
# ❌ Upload Failed

**Error:** ${error}

Please check your network and try again.
            `;
    }

    if (isLoading) {
      return `
# ⏳ Uploading...

**Status:** ${statusText}

Please wait while we send your data to the cloud.
            `;
    }

    // Generate QR code URL (using a smaller size to fit on screen)
    // 180x180 is sufficient for mobile scanning while saving UI space
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(downloadLink || "")}`;

    return `
# ✅ Upload Complete!

> The link has been copied to your clipboard.

[**🔗 Open in Browser**](${downloadLink})

---
![QR Code](${qrCodeUrl})
        `;
  };

  return (
    <Detail
      isLoading={isLoading}
      markdown={getMarkdown()}
      navigationTitle="tfLink tmpfile.link Upload"
      metadata={
        downloadLink ? (
          <Detail.Metadata>
            <Detail.Metadata.Label
              title="Status"
              text="Success"
              icon={{ source: Icon.CheckCircle, tintColor: "#2ecc71" }}
            />
            <Detail.Metadata.Label title="File Name" text={fileName || "-"} />
            <Detail.Metadata.Label title="File Size" text={fileSize || "-"} />
            <Detail.Metadata.Label
              title="Time Elapsed"
              text={`${elapsedTime}s`}
            />
            <Detail.Metadata.Separator />
            <Detail.Metadata.Label
              title="QR Code"
              text="Visible in Main View"
            />
            <Detail.Metadata.TagList title="Retention">
              <Detail.Metadata.TagList.Item text="7 Days" color={"#eed535"} />
            </Detail.Metadata.TagList>
          </Detail.Metadata>
        ) : (
          <Detail.Metadata>
            <Detail.Metadata.Label
              title="Status"
              text="Uploading"
              icon={{ source: Icon.CircleProgress, tintColor: "#3498db" }}
            />
            <Detail.Metadata.Label
              title="Time Elapsed"
              text={`${elapsedTime}s`}
            />
            {fileName && (
              <Detail.Metadata.Label title="File Name" text={fileName} />
            )}
            {fileSize && (
              <Detail.Metadata.Label title="File Size" text={fileSize} />
            )}
          </Detail.Metadata>
        )
      }
      actions={
        <ActionPanel>
          {!isLoading && downloadLink && (
            <>
              <Action.CopyToClipboard
                title="Copy Link"
                content={downloadLink}
              />
              <Action.OpenInBrowser
                title="Open in Browser"
                url={downloadLink}
              />
            </>
          )}
          {!isLoading && error && (
            <Action
              title="Retry"
              onAction={uploadFromClipboard}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
            />
          )}
        </ActionPanel>
      }
    />
  );
}
