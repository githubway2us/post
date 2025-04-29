const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const csurf = require('csurf');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const port = 3333;

const JWT_SECRET = 'your-secret-key'; // เปลี่ยนเป็นคีย์ที่ปลอดภัยใน production

// Middleware Setup
app.use(express.json());
app.use(cookieParser());
app.use(cors({
    origin: ['http://localhost:8080'],
    credentials: true
}));
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // เปลี่ยนเป็น true ถ้าใช้ HTTPS
}));

// Multer Setup for File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });
app.use('/uploads', express.static('uploads'));

// CSRF Protection
const csrfProtection = csurf({ cookie: true });
app.use(csrfProtection);

// SQLite Database Setup
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log('Connected to SQLite database.');
});

// ในส่วน SQLite Database Setup, แก้ไขการสร้างตาราง comments เป็น:
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        username TEXT UNIQUE, 
        password TEXT
    )`, err => { if (err) console.error('Error creating users table:', err.message); });

    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        content TEXT, 
        views INTEGER DEFAULT 0, 
        x REAL, 
        y REAL, 
        author TEXT, 
        timestamp TEXT, 
        isPublic INTEGER, 
        image TEXT
    )`, err => { if (err) console.error('Error creating posts table:', err.message); });

    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        postId INTEGER, 
        content TEXT, 
        author TEXT, 
        timestamp TEXT, 
        image TEXT, 
        parentId INTEGER, 
        FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (parentId) REFERENCES comments(id) ON DELETE CASCADE
    )`, err => { if (err) console.error('Error creating comments table:', err.message); });
});
// JWT Authentication Middleware
const authMiddleware = (req, res, next) => {
    let token = req.headers['authorization'];
    if (token && token.startsWith('Bearer ')) {
        token = token.split(' ')[1];
    } else {
        token = req.cookies['authToken'];
    }

    if (!token) {
        console.log('No token provided in request:', req.method, req.url);
        return res.status(401).json({ error: 'กรุณาล็อกอิน (ไม่มี token)' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error('Token verification failed:', err.message, 'Token:', token);
            return res.status(401).json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ', details: err.message });
        }
        req.user = decoded;
        console.log('Authenticated user:', req.user);
        next();
    });
};

// CSRF Token Endpoint
app.get('/api/csrf-token', (req, res) => {
    console.log('CSRF token requested');
    res.json({ csrfToken: req.csrfToken() });
});

// Register Endpoint
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    console.log('Register request:', { username });
    if (!username || !password) {
        return res.status(400).json({ error: 'กรุณาใส่ชื่อผู้ใช้และรหัสผ่าน' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], function(err) {
            if (err) {
                console.error('Register error:', err.message);
                return res.status(400).json({ error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });
            }
            console.log('User registered:', { id: this.lastID, username });
            res.json({ message: 'สมัครสมาชิกสำเร็จ' });
        });
    } catch (err) {
        console.error('Hashing error:', err.message);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
    }
});

// Login Endpoint
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    console.log('Login request:', { username });
    if (!username || !password) {
        return res.status(400).json({ error: 'กรุณาใส่ชื่อผู้ใช้และรหัสผ่าน' });
    }
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err) {
            console.error('Login database error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        if (!user || !(await bcrypt.compare(password, user.password))) {
            console.log('Invalid credentials for:', username);
            return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }
        req.session.user = username;
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
        console.log('Session set:', req.session);
        console.log('Token generated:', token);
        res.cookie('authToken', token, { httpOnly: true, secure: false });
        res.json({ message: 'ล็อกอินสำเร็จ', token });
    });
});

// Logout Endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        res.clearCookie('authToken');
        console.log('User logged out');
        res.json({ message: 'ออกจากระบบสำเร็จ' });
    });
});

// ... ส่วนอื่นๆ คงเดิมจนถึง endpoint สร้างโพสต์ ...

// Create Post Endpoint
app.post('/api/posts', authMiddleware, upload.single('image'), csrfProtection, (req, res) => {
    console.log('Create post request received:', { body: req.body, file: req.file, user: req.user.username });
    const { content, isPublic } = req.body;

    if (!content || typeof isPublic === 'undefined') {
        console.log('Missing content or isPublic');
        return res.status(400).json({ error: 'กรุณาใส่ content และ isPublic' });
    }

    const post = {
        content,
        views: 0,
        x: Math.random() * 1000,
        y: Math.random() * 600,
        author: req.user.username,
        timestamp: new Date().toLocaleString('th-TH'),
        isPublic: isPublic === 'true' ? 1 : 0,
        image: req.file ? `/uploads/${req.file.filename}` : null
    };

    db.run(
        `INSERT INTO posts (content, views, x, y, author, timestamp, isPublic, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [post.content, post.views, post.x, post.y, post.author, post.timestamp, post.isPublic, post.image],
        function(err) {
            if (err) {
                console.error('Post creation error:', err.message);
                return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์', details: err.message });
            }
            console.log('Post created successfully:', { id: this.lastID });
            res.json({ id: this.lastID, ...post });
        }
    );
});



// Get Private Posts Endpoint
app.get('/api/posts/private', authMiddleware, (req, res) => {
    console.log('Fetching private posts for:', req.user.username);
    db.all(`SELECT * FROM posts WHERE author = ? AND isPublic = 0`, [req.user.username], (err, rows) => {
        if (err) {
            console.error('Private posts error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        res.json(rows);
    });
});

// Get Public Posts Endpoint
app.get('/api/posts/public', (req, res) => {
    console.log('Fetching public posts');
    db.all(`SELECT * FROM posts WHERE isPublic = 1`, [], (err, rows) => {
        if (err) {
            console.error('Public posts error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        res.json(rows);
    });
});

// Create Comment Endpoint
// ในส่วน Create Comment Endpoint, แก้ไขเป็น:
app.post('/api/comments', authMiddleware, upload.single('image'), csrfProtection, (req, res) => {
    const { postId, content, parentId } = req.body;
    console.log('Create comment request:', { postId, content, parentId, user: req.user.username, file: req.file });
    
    if (!postId || !content) {
        console.log('Missing postId or content');
        return res.status(400).json({ error: 'กรุณาใส่ postId และ content' });
    }

    db.get(`SELECT isPublic FROM posts WHERE id = ?`, [postId], (err, post) => {
        if (err) {
            console.error('Error checking post:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์', details: err.message });
        }
        if (!post || post.isPublic !== 1) {
            console.log('Post not found or not public:', postId);
            return res.status(400).json({ error: 'โพสต์นี้ไม่สามารถคอมเมนต์ได้' });
        }

        const comment = {
            postId: parseInt(postId),
            content,
            author: req.user.username,
            timestamp: new Date().toLocaleString('th-TH'),
            image: req.file ? `/uploads/${req.file.filename}` : null,
            parentId: parentId ? parseInt(parentId) : null
        };

        db.run(
            `INSERT INTO comments (postId, content, author, timestamp, image, parentId) VALUES (?, ?, ?, ?, ?, ?)`,
            [comment.postId, comment.content, comment.author, comment.timestamp, comment.image, comment.parentId],
            function(err) {
                if (err) {
                    console.error('Comment creation error:', err.message);
                    return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์', details: err.message });
                }
                console.log('Comment created:', { id: this.lastID });
                res.json({ id: this.lastID, ...comment });
            }
        );
    });
});

// Get Comments Endpoint
app.get('/api/comments', (req, res) => {
    const postId = req.query.postId;
    console.log('Fetching comments for post:', postId);

    if (!postId || isNaN(parseInt(postId))) {
        console.log('Invalid or missing postId:', postId);
        return res.status(400).json({ error: 'กรุณาระบุ postId ที่ถูกต้อง' });
    }

    db.get(`SELECT id FROM posts WHERE id = ?`, [postId], (err, post) => {
        if (err) {
            console.error('Error checking post existence:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์', details: err.message });
        }
        if (!post) {
            console.log('Post not found:', postId);
            return res.status(404).json({ error: `ไม่พบโพสต์ที่มี ID ${postId}` });
        }

        db.all(`SELECT * FROM comments WHERE postId = ? ORDER BY timestamp ASC`, [postId], (err, rows) => {
            if (err) {
                console.error('Get comments error:', err.message);
                return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์', details: err.message });
            }
            console.log('Comments fetched:', rows.length);
            res.status(200).json(rows);
        });
    });
});

// Delete Post Endpoint
app.delete('/api/posts/:id', authMiddleware, csrfProtection, (req, res) => {
    const postId = req.params.id;
    console.log('Delete post request:', postId);
    db.get(`SELECT author FROM posts WHERE id = ?`, [postId], (err, post) => {
        if (err) {
            console.error('Delete post error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        if (!post || post.author !== req.user.username) {
            console.log('Unauthorized delete attempt by:', req.user.username);
            return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบโพสต์นี้' });
        }
        db.run(`DELETE FROM posts WHERE id = ?`, [postId], (err) => {
            if (err) {
                console.error('Delete post error:', err.message);
                return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
            }
            console.log('Post deleted:', postId);
            res.json({ message: 'ลบโพสต์สำเร็จ' });
        });
    });
});

// Update Views Endpoint
app.patch('/api/posts/:id/views', authMiddleware, csrfProtection, (req, res) => {
    const postId = req.params.id;
    const { views } = req.body;
    console.log('Update views request:', { postId, views });
    db.get(`SELECT author FROM posts WHERE id = ?`, [postId], (err, post) => {
        if (err) {
            console.error('Update views error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        if (!post || post.author !== req.user.username) {
            return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
        }
        db.run(`UPDATE posts SET views = views + ? WHERE id = ?`, [views, postId], (err) => {
            if (err) {
                console.error('Update views error:', err.message);
                return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
            }
            console.log('Views updated for post:', postId);
            res.json({ message: 'อัปเดตวิวสำเร็จ' });
        });
    });
});

// Edit Post Endpoint
app.put('/api/posts/:id', authMiddleware, csrfProtection, (req, res) => {
    const postId = req.params.id;
    const { content } = req.body;
    console.log('Edit post request:', { postId, content });
    if (!content) {
        return res.status(400).json({ error: 'กรุณาใส่ content' });
    }
    db.get(`SELECT author FROM posts WHERE id = ?`, [postId], (err, post) => {
        if (err) {
            console.error('Edit post error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        if (!post || post.author !== req.user.username) {
            return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
        }
        db.run(`UPDATE posts SET content = ? WHERE id = ?`, [content, postId], (err) => {
            if (err) {
                console.error('Edit post error:', err.message);
                return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
            }
            console.log('Post edited:', postId);
            res.json({ message: 'แก้ไขโพสต์สำเร็จ' });
        });
    });
});

// Get Single Post Endpoint
app.get('/api/posts/:id', authMiddleware, (req, res) => {
    const postId = req.params.id;
    console.log('Get post request:', postId);
    db.get(`SELECT * FROM posts WHERE id = ?`, [postId], (err, post) => {
        if (err) {
            console.error('Get post error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        if (!post || (post.author !== req.user.username && post.isPublic !== 1)) {
            return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูโพสต์นี้' });
        }
        res.json(post);
    });
});

// Start Server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}).on('error', (err) => {
    console.error('Server start error:', err);
});