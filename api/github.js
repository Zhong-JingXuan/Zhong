// Vercel Serverless Function - GitHub 数据操作
module.exports = async (req, res) => {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;
  const githubOwner = process.env.GITHUB_OWNER || '';
  const githubRepo = process.env.GITHUB_REPO || '';
  const githubToken = process.env.GITHUB_TOKEN || '';
  const githubPath = process.env.GITHUB_PATH || 'data.json';

  if (!githubOwner || !githubRepo || !githubToken) {
    return res.status(500).json({ 
      error: 'GitHub 配置不完整，请检查环境变量' 
    });
  }

  const filePath = encodeURIComponent(githubPath);
  const apiUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${filePath}`;

  try {
    if (action === 'read' || req.method === 'GET') {
      // 读取数据
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (response.status === 404) {
        return res.status(200).json({ 
          data: [],
          sha: null,
          message: '文件不存在，返回空数组'
        });
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      // 解码 base64（Node.js 环境使用 Buffer）
      const content = Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8');
      const jsonData = JSON.parse(content);

      return res.status(200).json({
        data: jsonData,
        sha: data.sha
      });

    } else if (action === 'write' || req.method === 'POST' || req.method === 'PUT') {
      // 写入数据
      const { data, sha } = req.body;

      if (!data) {
        return res.status(400).json({ error: '缺少数据参数' });
      }

      // 先获取当前文件的 SHA（如果存在）
      let currentSha = sha;
      if (!currentSha) {
        try {
          const getResponse = await fetch(apiUrl, {
            headers: {
              'Authorization': `token ${githubToken}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          });
          if (getResponse.ok) {
            const fileData = await getResponse.json();
            currentSha = fileData.sha;
          }
        } catch (e) {
          // 文件不存在，使用 null
          currentSha = null;
        }
      }

      // 编码数据为 base64（Node.js 环境使用 Buffer）
      const content = Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64');

      const body = {
        message: `Update data at ${new Date().toISOString()}`,
        content: content
      };

      if (currentSha) {
        body.sha = currentSha;
      }

      const response = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const result = await response.json();

      return res.status(200).json({
        success: true,
        message: '数据已保存到 GitHub',
        sha: result.content.sha
      });

    } else {
      return res.status(400).json({ error: '无效的操作' });
    }
  } catch (error) {
    console.error('GitHub API 错误:', error);
    return res.status(500).json({ 
      error: error.message || 'GitHub API 操作失败' 
    });
  }
}

