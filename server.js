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

app.use(express.json());
app.use(cookieParser());
app.use(cors({ 
    origin: ['http://localhost', 'https://courage-earnings-rides-messenger.trycloudflare.com'],
    credentials: true 
}));
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // เปลี่ยนเป็น true ถ้าใช้ HTTPS
}));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });
app.use('/uploads', express.static('uploads'));

const csrfProtection = csurf({ cookie: true });
app.use(csrfProtection);

const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log('Connected to SQLite database.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT)`, 
        err => { if (err) console.error('Error creating users table:', err.message); });
    db.run(`CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, views INTEGER, x REAL, y REAL, author TEXT, timestamp TEXT, isPublic INTEGER, image TEXT)`, 
        err => { if (err) console.error('Error creating posts table:', err.message); });
    db.run(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, postId INTEGER, content TEXT, author TEXT, timestamp TEXT)`, 
        err => { if (err) console.error('Error creating comments table:', err.message); });
});

// Middleware ตรวจสอบ JWT
const authMiddleware = (req, res, next) => {
    // 1. ดึง JWT จาก Authorization header หรือ cookie
    let token = req.headers['authorization'];
    if (token && token.startsWith('Bearer ')) {
        token = token.split(' ')[1]; // ดึง token จาก "Bearer <token>"
    } else {
        token = req.cookies['authToken']; // ดึงจาก cookie ถ้าไม่มีใน header
    }

    // 2. ตรวจสอบว่า token มีหรือไม่
    if (!token) {
        console.log('No token provided');
        return res.status(401).json({ error: 'กรุณาล็อกอิน (ไม่มี token)' });
    }

    // 3. ตรวจสอบ signature และวันหมดอายุของ token
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error('Token verification failed:', err.message);
            return res.status(401).json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ' });
        }

        // 4. ถ้าถูกต้อง ตั้งค่า req.user
        req.user = decoded; // decoded จะมีข้อมูลเช่น { username: "user" }
        console.log('Authenticated user:', req.user);
        next(); // ไปยัง route handler
    });
};

// CSRF Token endpoint
app.get('/api/csrf-token', (req, res) => {
    console.log('CSRF token requested');
    res.json({ csrfToken: req.csrfToken() });
});

// Register endpoint
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
            res.json({ message: 'สมัครสมาชิกสำเร็จ' });
        });
    } catch (err) {
        console.error('Hashing error:', err.message);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
    }
});

// Login endpoint (ส่ง token กลับไป)
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
            return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }
        req.session.user = username; // ยังคงใช้ session ร่วมด้วย
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
        console.log('Session set:', req.session);
        console.log('Token generated:', token);
        // ตั้ง cookie (ถ้าต้องการส่ง token ทาง cookie ด้วย)
        res.cookie('authToken', token, { httpOnly: true, secure: false }); // secure: true ถ้าใช้ HTTPS
        res.json({ message: 'ล็อกอินสำเร็จ', token });
    });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        res.clearCookie('authToken'); // ลบ cookie ถ้ามี
        res.json({ message: 'ออกจากระบบสำเร็จ' });
    });
});

// Create post endpoint
app.post('/api/posts', authMiddleware, upload.single('image'), (req, res) => {
    console.log('Create post request:', req.body, req.file);
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
        function (err) {
            if (err) {
                console.error('Post creation error:', err.message);
                return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์', details: err.message });
            }
            console.log('Post created:', { id: this.lastID });
            res.json({ id: this.lastID, ...post });
        }
    );
});

// Get private posts endpoint (ใช้ authMiddleware)
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

// Get public posts endpoint (ไม่ต้องใช้ authMiddleware)
app.get('/api/posts/public', (req, res) => {
    db.all(`SELECT * FROM posts WHERE isPublic = 1`, [], (err, rows) => {
        if (err) {
            console.error('Public posts error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        res.json(rows);
    });
});

// Create comment endpoint
app.post('/api/comments', authMiddleware, csrfProtection, (req, res) => {
    const { postId, content } = req.body;
    if (!postId || !content) {
        return res.status(400).json({ error: 'กรุณาใส่ postId และ content' });
    }
    const comment = {
        postId,
        content,
        author: req.user.username,
        timestamp: new Date().toLocaleString('th-TH')
    };
    db.run(
        `INSERT INTO comments (postId, content, author, timestamp) VALUES (?, ?, ?, ?)`,
        [comment.postId, comment.content, comment.author, comment.timestamp],
        function (err) {
            if (err) {
                console.error('Comment creation error:', err.message);
                return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
            }
            res.json({ id: this.lastID, ...comment });
        }
    );
});

// Get comments endpoint
app.get('/api/comments/:postId', (req, res) => {
    db.all(`SELECT * FROM comments WHERE postId = ?`, [req.params.postId], (err, rows) => {
        if (err) {
            console.error('Get comments error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        res.json(rows);
    });
});

// Delete post endpoint
app.delete('/api/posts/:id', authMiddleware, (req, res) => {
    db.get(`SELECT author FROM posts WHERE id = ?`, [req.params.id], (err, post) => {
        if (err) {
            console.error('Delete post error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        if (!post || post.author !== req.user.username) {
            return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
        }
        db.run(`DELETE FROM posts WHERE id = ?`, [req.params.id], (err) => {
            if (err) {
                console.error('Delete post error:', err.message);
                return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
            }
            db.run(`DELETE FROM comments WHERE postId = ?`, [req.params.id], (err) => {
                if (err) console.error('Delete comments error:', err.message);
            });
            res.json({ message: 'ลบสำเร็จ' });
        });
    });
});

// Update views endpoint
app.patch('/api/posts/:id', authMiddleware, (req, res) => {
    const { views } = req.body;
    db.get(`SELECT author FROM posts WHERE id = ?`, [req.params.id], (err, post) => {
        if (err) {
            console.error('Update views error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        if (!post || post.author !== req.user.username) {
            return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
        }
        db.run(`UPDATE posts SET views = views + ? WHERE id = ?`, [views, req.params.id], (err) => {
            if (err) {
                console.error('Update views error:', err.message);
                return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
            }
            res.json({ message: 'อัปเดตวิวสำเร็จ' });
        });
    });
});

// Edit post endpoint
app.put('/api/posts/:id', authMiddleware, (req, res) => {
    const { content, isEditing } = req.body;
    db.get(`SELECT author FROM posts WHERE id = ?`, [req.params.id], (err, post) => {
        if (err) {
            console.error('Edit post error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        if (!post || post.author !== req.user.username) {
            return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
        }
        db.run(`UPDATE posts SET content = ?, isEditing = ? WHERE id = ?`, [content, isEditing ? 1 : 0, req.params.id], (err) => {
            if (err) {
                console.error('Edit post error:', err.message);
                return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
            }
            res.json({ message: 'แก้ไขโพสต์สำเร็จ' });
        });
    });
});

// Get single post endpoint
app.get('/api/posts/:id', authMiddleware, (req, res) => {
    db.get(`SELECT * FROM posts WHERE id = ?`, [req.params.id], (err, post) => {
        if (err) {
            console.error('Get post error:', err.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
        }
        if (!post || (post.author !== req.user.username && post.isPublic !== 1)) {
            return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
        }
        res.json(post);
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}).on('error', (err) => {
    console.error('Server start error:', err);
});