declare const ASHFOX_DEV_VIEWER_BUNDLE: string;

export const renderDevViewerHtml = (): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ashfox Dev</title>
</head>
<body>
<script>${ASHFOX_DEV_VIEWER_BUNDLE}</script>
</body>
</html>`;
