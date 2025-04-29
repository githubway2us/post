const dbName = "PostDB";
const postStoreName = "posts";
let db;
let users = JSON.parse(localStorage.getItem("users")) || {};
let currentUser = localStorage.getItem("currentUser") || null;
let csrfToken = null;
let jwtToken = localStorage.getItem("authToken") || null;
const postsPerPage = 5;
let currentPage = 1;
let publicPage = 1;
const POST_WIDTH = 320;
const POST_HEIGHT = 220;
let pendingPublicPost = null;
const binanceApiUrl = "https://api.binance.com/api/v3/klines";

// เริ่มต้น IndexedDB
function initDB() {
    const request = indexedDB.open(dbName, 2);
    request.onupgradeneeded = function(event) {
        db = event.target.result;
        if (!db.objectStoreNames.contains(postStoreName)) {
            const postStore = db.createObjectStore(postStoreName, { keyPath: "id", autoIncrement: true });
            postStore.createIndex("author", "author", { unique: false });
            postStore.createIndex("timestamp", "timestamp", { unique: false });
        }
    };
    request.onsuccess = function(event) {
        db = event.target.result;
        loadInitialData();
    };
    request.onerror = function(event) {
        console.error("IndexedDB error:", event.target.errorCode);
    };
}

// โหลดข้อมูลเริ่มต้น
function loadInitialData() {
    if (currentUser && users[currentUser]) {
        document.getElementById("loginPage").style.display = "none";
        document.getElementById("mainPage").style.display = "block";
        document.getElementById("currentUser").textContent = currentUser;
        renderPosts();
        if (jwtToken) renderPublicTable();
    } else {
        document.getElementById("loginPage").style.display = "block";
        document.getElementById("mainPage").style.display = "none";
    }
}

// ดึง CSRF Token
async function fetchCsrfToken() {
    try {
        const response = await fetch("http://localhost:3333/api/csrf-token", { credentials: "include" });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch CSRF token: ${response.status} - ${errorText}`);
        }
        const data = await response.json();
        csrfToken = data.csrfToken;
        console.log("CSRF token fetched:", csrfToken);
        return csrfToken;
    } catch (error) {
        console.error("CSRF token fetch error:", error);
        throw error; // ส่งต่อข้อผิดพลาดให้ผู้เรียกจัดการ
    }
}

// เริ่มต้นเมื่อโหลดหน้า
window.onload = async function() {
    initDB();
    makeDraggable(document.getElementById("loginPage"));
    makeDraggable(document.getElementById("mainPage"));
    makeDraggable(document.getElementById("serverLoginPage"));
    await fetchCsrfToken();
};

// สมัครสมาชิก (Local)
function register() {
    let username = document.getElementById("loginUsername").value.trim();
    let password = document.getElementById("loginPassword").value.trim();
    if (username === "" || password === "") {
        alert("กรุณาใส่ชื่อผู้ใช้และรหัสผ่าน!");
        return;
    }
    if (users[username]) {
        alert("ชื่อผู้ใช้นี้มีอยู่แล้ว!");
        return;
    }
    users[username] = password;
    localStorage.setItem("users", JSON.stringify(users));
    alert("สมัครสมาชิกสำเร็จ! กรุณาล็อกอิน");
    document.getElementById("loginUsername").value = "";
    document.getElementById("loginPassword").value = "";
}

// ล็อกอิน (Local)
function login() {
    let username = document.getElementById("loginUsername").value.trim();
    let password = document.getElementById("loginPassword").value.trim();
    if (users[username] && users[username] === password) {
        currentUser = username;
        localStorage.setItem("currentUser", currentUser);
        document.getElementById("loginPage").style.display = "none";
        document.getElementById("mainPage").style.display = "block";
        document.getElementById("currentUser").textContent = currentUser;
        renderPosts();
    } else {
        alert("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง!");
    }
}

// ออกจากระบบ
function logout() {
    localStorage.removeItem("currentUser");
    localStorage.removeItem("authToken");
    currentUser = null;
    jwtToken = null;
    document.getElementById("mainPage").style.display = "none";
    document.getElementById("loginPage").style.display = "block";
    document.getElementById("loginUsername").value = "";
    document.getElementById("loginPassword").value = "";
}

// สมัครสมาชิก Server
async function serverRegister() {
    const username = document.getElementById("serverUsername").value.trim();
    const password = document.getElementById("serverPassword").value.trim();
    if (!username || !password) {
        alert("กรุณาใส่ชื่อผู้ใช้และรหัสผ่าน!");
        return;
    }
    try {
        await fetchCsrfToken();
        const response = await fetch("http://localhost:3333/api/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrfToken
            },
            credentials: "include",
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (response.ok) {
            alert("สมัครสมาชิกเซิร์ฟเวอร์สำเร็จ! กรุณาล็อกอิน");
            document.getElementById("serverUsername").value = "";
            document.getElementById("serverPassword").value = "";
        } else {
            throw new Error(data.error || "สมัครสมาชิกเซิร์ฟเวอร์ล้มเหลว");
        }
    } catch (error) {
        console.error("Server register error:", error);
        alert("สมัครสมาชิกเซิร์ฟเวอร์ล้มเหลว: " + error.message);
    }
}

// ล็อกอิน Server
async function serverLogin() {
    const username = document.getElementById("serverUsername").value.trim();
    const password = document.getElementById("serverPassword").value.trim();
    if (!username || !password) {
        alert("กรุณาใส่ชื่อผู้ใช้และรหัสผ่าน!");
        return;
    }
    try {
        await fetchCsrfToken();
        const response = await fetch("http://localhost:3333/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrfToken
            },
            credentials: "include",
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (response.ok) {
            jwtToken = data.token;
            localStorage.setItem("authToken", jwtToken);
            hideServerLogin();
            if (pendingPublicPost) {
                await createPublicPost(pendingPublicPost);
                pendingPublicPost = null;
            }
            renderPublicTable();
        } else {
            throw new Error(data.error || "ล็อกอินเซิร์ฟเวอร์ล้มเหลว");
        }
    } catch (error) {
        console.error("Server login error:", error);
        alert("ล็อกอินเซิร์ฟเวอร์ล้มเหลว: " + error.message);
    }
}

// ... ส่วนอื่นๆ คงเดิมจนถึงฟังก์ชัน createPost ...

// สร้างโพสต์
async function createPost() {
    let message = document.getElementById("message").value.trim();
    let imageFile = document.getElementById("image").files[0];
    let isPublic = document.getElementById("isPublic").checked;

    if (!message) {
        alert("กรุณาใส่ข้อความ!");
        return;
    }

    if (message === "/help") {
        alert(`
คู่มือการใช้งาน PUKUMPEE Time Capsule
----------------------------------------
1. ล็อกอิน/สมัครสมาชิก
   - ใช้ "ชื่อผู้ใช้" และ "รหัสผ่าน" ในหน้าแรกเพื่อล็อกอิน
   - คลิก "สมัครสมาชิก" หากยังไม่มีบัญชี (เก็บในเครื่อง)

2. สร้างโพสต์
   - พิมพ์ข้อความในช่อง "พิมพ์ข้อความที่นี่"
   - อัปโหลดรูปภาพ (ถ้ามี) โดยเลือกไฟล์
   - เลือก "โพสต์สาธารณะ" ถ้าต้องการแชร์ (ต้องล็อกอินเซิร์ฟเวอร์)

3. โพสต์สาธารณะ
   - ต้องล็อกอินเซิร์ฟเวอร์ด้วยบัญชี (เช่น testuser/testpass)
   - โพสต์จะปรากฏในแท็บ "โพสต์สาธารณะ"
   - ผู้ใช้ที่ล็อกอินเซิร์ฟเวอร์สามารถคอมเมนต์ได้

4. คำสั่งพิเศษ
   - /help: แสดงคู่มือนี้
   - /[crypto]: ดึงข้อมูลคริปโต เช่น /BTC หรือ /ETH
     - แสดงราคาเรียลไทม์, MACD, และ Fibonacci Levels

5. การจัดการโพสต์
   - แท็บ "โพสต์ส่วนตัว": ดู/แก้ไข/ลบโพสต์ของตัวเอง
   - แท็บ "โพสต์สาธารณะ": ดูโพสต์สาธารณะทั้งหมด, ลบได้ถ้าเป็นของตัวเอง
   - คลิกโพสต์ในตารางเพื่อดูในหน้าต่าง (ลากได้)

6. อื่นๆ
   - "จัดเรียงอัตโนมัติ": จัดตำแหน่งหน้าต่างโพสต์ใหม่
   - "ออกจากระบบ": ออกจากบัญชีทั้งหมด
        `);
        resetPostForm();
        return;
    }

    let postContent = message;
    const cryptoCommand = message.match(/\/([a-zA-Z]+)/);
    if (cryptoCommand) {
        const symbol = cryptoCommand[1];
        try {
            const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}usdt@ticker`);
            const pricePromise = new Promise((resolve) => {
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    resolve(parseFloat(data.c));
                    ws.close();
                };
            });
            const price = await pricePromise;
            const klineData = await fetchKlineData(symbol);
            const prices = klineData.map(k => k.close);
            const macd = calculateMACD(prices);
            const fib = calculateFibonacci(prices.slice(-50));

            postContent += `
                <br>ราคา ${symbol.toUpperCase()}/USDT (เรียลไทม์): ${price.toFixed(2)} USDT
                <br>MACD: Line: ${macd.macdLine.toFixed(2)}, Signal: ${macd.signalLine.toFixed(2)}, Histogram: ${macd.histogram.toFixed(2)}
                <br>Fibonacci Levels:
                <br>0.0%: ${fib["0.0%"].toFixed(2)}
                <br>23.6%: ${fib["23.6%"].toFixed(2)}
                <br>38.2%: ${fib["38.2%"].toFixed(2)}
                <br>50.0%: ${fib["50.0%"].toFixed(2)}
                <br>61.8%: ${fib["61.8%"].toFixed(2)}
                <br>100.0%: ${fib["100.0%"].toFixed(2)}
            `;
        } catch (error) {
            console.error("Error fetching crypto data:", error);
            postContent += `<br>เกิดข้อผิดพลาดในการดึงข้อมูล ${symbol}: ${error.message}`;
        }
    }

    const post = {
        content: postContent,
        views: 0,
        x: window.innerWidth - POST_WIDTH - 20,
        y: 20,
        isEditing: false,
        author: currentUser,
        timestamp: new Date().toLocaleString("th-TH"),
        isPublic: isPublic
    };

    try {
        if (imageFile) {
            const reader = new FileReader();
            reader.onload = async function(e) {
                post.image = e.target.result;
                await handlePostCreation(post, isPublic);
            };
            reader.onerror = function() {
                alert("เกิดข้อผิดพลาดในการอ่านไฟล์รูปภาพ!");
            };
            reader.readAsDataURL(imageFile);
        } else {
            await handlePostCreation(post, isPublic);
        }
    } catch (error) {
        console.error("Error in createPost:", error);
        alert("เกิดข้อผิดพลาดในการสร้างโพสต์: " + error.message);
    }
}

// ฟังก์ชันช่วยจัดการการสร้างโพสต์
async function handlePostCreation(post, isPublic) {
    if (isPublic) {
        if (!jwtToken) {
            pendingPublicPost = post;
            showServerLogin();
        } else {
            await createPublicPost(post);
        }
    } else {
        addPostToDB(post);
    }
    resetPostForm(); // รีเซ็ตฟอร์มหลังโพสต์เสมอ
}

// รีเซ็ตฟอร์มโพสต์
function resetPostForm() {
    document.getElementById("message").value = "";
    document.getElementById("image").value = "";
    document.getElementById("isPublic").checked = false;
    pendingPublicPost = null; // รีเซ็ตสถานะ pendingPublicPost
}

// สร้างโพสต์สาธารณะ
async function createPublicPost(post) {
    try {
        await fetchCsrfToken();
        const formData = new FormData();
        formData.append("content", post.content);
        formData.append("isPublic", "true");
        if (post.image && post.image.startsWith("data:")) {
            const response = await fetch(post.image);
            const blob = await response.blob();
            formData.append("image", blob, "post-image.jpg");
        }

        const response = await fetch("http://localhost:3333/api/posts", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${jwtToken}`,
                "X-CSRF-Token": csrfToken
            },
            credentials: "include",
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || "Failed to create public post");
        }

        const serverPost = await response.json();
        switchTab('publicTab');
        renderPublicTable();
    } catch (error) {
        console.error("Error creating public post:", error);
        alert("เกิดข้อผิดพลาดในการโพสต์สาธารณะ: " + error.message);
    }
}




// สร้างโพสต์สาธารณะ
async function createPublicPost(post) {
    try {
        await fetchCsrfToken();
        const formData = new FormData();
        formData.append("content", post.content);
        formData.append("isPublic", "true");
        if (post.image) {
            const response = await fetch(post.image);
            const blob = await response.blob();
            formData.append("image", blob, "post-image.jpg");
        }

        const response = await fetch("http://localhost:3333/api/posts", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${jwtToken}`,
                "X-CSRF-Token": csrfToken
            },
            credentials: "include",
            body: formData
        });

        if (!response.ok) throw new Error(await response.text());
        document.getElementById("message").value = "";
        document.getElementById("image").value = "";
        document.getElementById("isPublic").checked = false;
        switchTab('publicTab');
        renderPublicTable();
    } catch (error) {
        console.error("Error creating public post:", error);
        alert("เกิดข้อผิดพลาดในการโพสต์สาธารณะ: " + error.message);
    }
}

// ดึงข้อมูล Kline จาก Binance
async function fetchKlineData(symbol, interval = "1h", limit = 100) {
    try {
        const response = await fetch(`${binanceApiUrl}?symbol=${symbol.toUpperCase()}USDT&interval=${interval}&limit=${limit}`);
        if (!response.ok) throw new Error("Failed to fetch Kline data");
        const data = await response.json();
        return data.map(item => ({
            time: item[0],
            close: parseFloat(item[4])
        }));
    } catch (error) {
        console.error("Error fetching Kline data:", error);
        return [];
    }
}

// คำนวณ EMA
function calculateEMA(prices, period) {
    const k = 2 / (period + 1);
    let ema = [prices[0]];
    for (let i = 1; i < prices.length; i++) {
        ema.push(prices[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
}

// คำนวณ MACD
function calculateMACD(prices) {
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const macdLine = ema12.map((val, i) => val - ema26[i]);
    const signalLine = calculateEMA(macdLine, 9);
    const histogram = macdLine.map((val, i) => val - signalLine[i]);
    return { macdLine: macdLine.slice(-1)[0], signalLine: signalLine.slice(-1)[0], histogram: histogram.slice(-1)[0] };
}

// คำนวณ Fibonacci
function calculateFibonacci(prices) {
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const diff = high - low;
    return {
        "0.0%": high,
        "23.6%": high - diff * 0.236,
        "38.2%": high - diff * 0.382,
        "50.0%": high - diff * 0.5,
        "61.8%": high - diff * 0.618,
        "100.0%": low
    };
}

// แสดง/ซ่อน Server Login
function showServerLogin() {
    document.getElementById("serverLoginPage").style.display = "block";
    document.getElementById("overlay").style.display = "block";
    document.body.style.overflow = "hidden";
}

function hideServerLogin() {
    document.getElementById("serverLoginPage").style.display = "none";
    document.getElementById("overlay").style.display = "none";
    document.body.style.overflow = "auto";
    document.getElementById("serverUsername").value = "";
    document.getElementById("serverPassword").value = "";
}

function closeServerLogin() {
    hideServerLogin();
    document.getElementById("isPublic").checked = false;
    pendingPublicPost = null;
}

// เพิ่มโพสต์ลง IndexedDB
function addPostToDB(post) {
    const transaction = db.transaction([postStoreName], "readwrite");
    const objectStore = transaction.objectStore(postStoreName);
    const request = objectStore.add(post);
    request.onsuccess = function() {
        document.getElementById("message").value = "";
        document.getElementById("image").value = "";
        document.getElementById("isPublic").checked = false;
        renderPosts();
        renderPrivateTable();
    };
    request.onerror = function(event) {
        console.error("Error adding post to DB:", event.target.error);
    };
}

// แสดงโพสต์ในหน้าต่าง
async function showPostWindow(post, isEditable) {
    let postsDiv = document.getElementById("posts");
    let postDiv = document.createElement("div");
    postDiv.className = "post";
    postDiv.dataset.id = post.id;

    let contentDiv = `<div class="post-content" draggable="true" ondragstart="dragContent(event, ${post.id})">${post.content || "ไม่มีข้อความ"}</div>`;
    if (post.isEditing && isEditable) {
        contentDiv = `<textarea id="edit-${post.id}" rows="2">${post.content}</textarea>`;
    }

    let commentsHtml = "";
    if (post.isPublic) {
        try {
            // ตรวจสอบและดึง CSRF token ถ้ายังไม่มี
            if (!csrfToken) {
                await fetchCsrfToken();
            }

            const response = await fetch(`http://localhost:3333/api/comments?postId=${post.id}`, {
                method: "GET",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": jwtToken ? `Bearer ${jwtToken}` : undefined
                }
            });

            if (!response.ok) {
                let errorMessage = "เกิดข้อผิดพลาดในการโหลดคอมเมนต์";
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch {
                    errorMessage = `สถานะ ${response.status}: ${await response.text()}`;
                }
                throw new Error(errorMessage);
            }

            const comments = await response.json();

            // สร้างโครงสร้างคอมเมนต์แบบซ้อนกัน
            const buildCommentTree = (comments, parentId = null, level = 0) => {
                let html = "";
                comments
                    .filter(c => (c.parentId || null) === parentId)
                    .forEach(c => {
                        const indentClass = level > 0 ? "reply" : "";
                        html += `
                            <div class="comment ${indentClass}" data-comment-id="${c.id}">
                                <p>
                                    <strong>${c.author}:</strong> ${c.content}
                                    <span>(${c.timestamp})</span>
                                    ${jwtToken ? `<button class="reply-btn" onclick="showReplyForm(${post.id}, ${c.id})">ตอบ</button>` : ""}
                                </p>
                                ${c.image ? `<img src="http://localhost:3333${c.image}" alt="คอมเมนต์รูปภาพ">` : ""}
                                ${buildCommentTree(comments, c.id, level + 1)}
                            </div>
                        `;
                    });
                return html;
            };

            commentsHtml = `
                <div class="comments" id="comments-section-${post.id}">
                    <h4>คอมเมนต์ (${comments.length}):</h4>
                    <div id="comments-${post.id}">
                        ${buildCommentTree(comments)}
                    </div>
                    ${jwtToken ? `
                        <textarea id="comment-input-${post.id}" rows="2" placeholder="เขียนคอมเมนต์..."></textarea>
                        <input type="file" id="comment-image-${post.id}" accept="image/*">
                        <button onclick="addComment(${post.id}, document.getElementById('comment-input-${post.id}').value, null, document.getElementById('comment-image-${post.id}').files[0])">ส่งคอมเมนต์</button>
                    ` : `<p>ล็อกอินเซิร์ฟเวอร์เพื่อคอมเมนต์</p>`}
                    <div id="reply-form-${post.id}"></div>
                </div>
            `;
        } catch (error) {
            console.error("Error fetching comments:", error);
            commentsHtml = `<p>เกิดข้อผิดพลาดในการโหลดคอมเมนต์: ${error.message}</p>`;
        }
    }

    postDiv.innerHTML = `
        <div class="post-header">
            <div class="traffic-lights">
                <button class="close-btn" onclick="closePostWindow(this)"></button>
                <button class="minimize-btn" onclick="minimizePostWindow(this)"></button>
                <button class="maximize-btn" onclick="toggleMaximize(this.parentElement.parentElement.parentElement)"></button>
            </div>
            <span><span class="post-number">${post.id}</span> ${post.author} - ${post.timestamp}</span>
        </div>
        ${contentDiv}
        ${post.image ? `<img src="${post.image.startsWith('data:') ? post.image : 'http://localhost:3333' + post.image}" alt="โพสต์รูปภาพ" class="post-image">` : ""}
        <p>วิว: <span id="views-${post.id}">${post.views}</span></p>
        ${isEditable ? `
            <div class="post-buttons">
                <button onclick="updateViews(${post.id}, 1)">+</button>
                <button onclick="updateViews(${post.id}, -1)">-</button>
                ${post.isEditing ? `<button onclick="saveEdit(${post.id})">บันทึก</button>` : `<button onclick="startEditing(${post.id})">แก้ไข</button>`}
            </div>` : ""}
        ${commentsHtml}
    `;
    postsDiv.appendChild(postDiv);
    makeDraggable(postDiv);
    positionPost(postDiv, post.x, post.y);
}

async function addComment(postId, content, parentId = null, imageFile = null) {
    if (!content.trim()) {
        alert("กรุณาใส่คอมเมนต์!");
        return;
    }
    if (!jwtToken) {
        showServerLogin();
        return;
    }

    try {
        await fetchCsrfToken();
        const formData = new FormData();
        formData.append("postId", postId);
        formData.append("content", content);
        if (parentId) {
            formData.append("parentId", parentId);
        }
        if (imageFile) {
            formData.append("image", imageFile);
        }

        const response = await fetch("http://localhost:3333/api/comments", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${jwtToken}`,
                "X-CSRF-Token": csrfToken
            },
            credentials: "include",
            body: formData
        });

        if (!response.ok) throw new Error(await response.text());
        const newComment = await response.json();

        // อัปเดต UI โดยโหลดคอมเมนต์ใหม่
        const postDiv = document.querySelector(`.post[data-id="${postId}"]`);
        if (postDiv) {
            postDiv.remove(); // ลบหน้าต่างเก่า
            const response = await fetch(`http://localhost:3333/api/posts/${postId}`, {
                headers: { "Authorization": `Bearer ${jwtToken}` }
            });
            const post = await response.json();
            showPostWindow(post, post.author === currentUser);
        }

        // ล้างฟอร์ม
        if (!parentId) {
            document.getElementById(`comment-input-${postId}`).value = "";
            document.getElementById(`comment-image-${postId}`).value = "";
        } else {
            document.getElementById(`reply-form-${postId}`).innerHTML = "";
        }
        renderPublicTable();
    } catch (error) {
        console.error("Error adding comment:", error);
        alert("เกิดข้อผิดพลาดในการส่งคอมเมนต์: " + error.message);
    }
}

// เพิ่มคอมเมนต์
async function addComment(postId, content) {
    if (!content.trim()) {
        alert("กรุณาใส่คอมเมนต์!");
        return;
    }
    if (!jwtToken) {
        showServerLogin();
        return;
    }

    try {
        await fetchCsrfToken();
        const response = await fetch("http://localhost:3333/api/comments", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${jwtToken}`,
                "X-CSRF-Token": csrfToken
            },
            credentials: "include",
            body: JSON.stringify({ postId, content })
        });
        if (!response.ok) throw new Error(await response.text());
        const newComment = await response.json();

        const commentsDiv = document.getElementById(`comments-${postId}`);
        if (commentsDiv) {
            const commentP = document.createElement("p");
            commentP.innerHTML = `<strong>${newComment.author}:</strong> ${newComment.content} <span>(${newComment.timestamp})</span>`;
            commentsDiv.appendChild(commentP);
            document.getElementById(`comment-input-${postId}`).value = "";
            const commentSection = document.getElementById(`comments-section-${postId}`);
            const commentCount = commentsDiv.children.length;
            commentSection.querySelector("h4").textContent = `คอมเมนต์ (${commentCount}):`;
        }
        renderPublicTable();
    } catch (error) {
        console.error("Error adding comment:", error);
        alert("เกิดข้อผิดพลาดในการส่งคอมเมนต์: " + error.message);
    }
}

// จัดตำแหน่งโพสต์
function positionPost(postDiv, initialX, initialY) {
    const posts = document.querySelectorAll(".post");
    let x = initialX;
    let y = initialY;
    if (!posts.length || postDiv === posts[0]) {
        x = window.innerWidth - POST_WIDTH - 20;
        y = 20;
    } else {
        posts.forEach(otherPost => {
            if (otherPost !== postDiv && otherPost.style.display !== "none") {
                const otherRect = otherPost.getBoundingClientRect();
                x = window.innerWidth - POST_WIDTH - 20;
                y = otherRect.bottom + 20;
                if (y + POST_HEIGHT > window.innerHeight) {
                    x = otherRect.left - POST_WIDTH - 20;
                    y = 20;
                }
            }
        });
    }
    postDiv.style.left = `${Math.max(0, x)}px`;
    postDiv.style.top = `${Math.max(0, y)}px`;
}

// จัดเรียงโพสต์
function arrangePosts() {
    const posts = document.querySelectorAll(".post");
    let x = window.innerWidth - POST_WIDTH - 20;
    let y = 20;
    posts.forEach(post => {
        if (post.style.display !== "none") {
            post.style.left = `${x}px`;
            post.style.top = `${y}px`;
            y += POST_HEIGHT + 20;
            if (y + POST_HEIGHT > window.innerHeight) {
                y = 20;
                x -= POST_WIDTH + 20;
            }
        }
    });
}

// ปิด/ย่อ/ขยายหน้าต่างโพสต์
function closePostWindow(button) { button.closest(".post").remove(); }
function minimizePostWindow(button) { button.closest(".post").style.display = "none"; }
function toggleMaximize(postDiv) {
    if (postDiv.style.width === "90vw") {
        postDiv.style.width = "300px";
        postDiv.style.height = "auto";
        postDiv.style.left = `${postDiv.dataset.originalX}px`;
        postDiv.style.top = `${postDiv.dataset.originalY}px`;
    } else {
        postDiv.dataset.originalX = postDiv.style.left;
        postDiv.dataset.originalY = postDiv.style.top;
        postDiv.style.width = "90vw";
        postDiv.style.height = "80vh";
        postDiv.style.left = "5vw";
        postDiv.style.top = "10vh";
    }
}

// แสดงโพสต์ส่วนตัว
function renderPosts() {
    let postsDiv = document.getElementById("posts");
    postsDiv.innerHTML = "";
    const transaction = db.transaction([postStoreName], "readonly");
    const objectStore = transaction.objectStore(postStoreName);
    const request = objectStore.getAll();
    request.onsuccess = function(event) {
        const posts = event.target.result;
        posts.filter(post => post.author === currentUser && !post.isPublic).forEach(post => showPostWindow(post, true));
    };
    request.onerror = function(event) {
        console.error("Error fetching posts:", event.target.error);
    };
}

// แสดงตารางโพสต์ส่วนตัว
function renderPrivateTable() {
    let tableBody = document.getElementById("postTableBody");
    tableBody.innerHTML = "";
    const transaction = db.transaction([postStoreName], "readonly");
    const objectStore = transaction.objectStore(postStoreName);
    const request = objectStore.getAll();
    request.onsuccess = function(event) {
        let privatePosts = event.target.result.filter(post => post.author === currentUser && !post.isPublic);
        let start = (currentPage - 1) * postsPerPage;
        let end = start + postsPerPage;
        let paginatedPosts = privatePosts.slice(start, end);

        paginatedPosts.forEach(post => {
            let row = document.createElement("tr");
            row.innerHTML = `
                <td class="id-column">${post.id}</td>
                <td><pre>${post.content || "ไม่มีข้อความ"}</pre></td>
                <td>${post.image ? `<img src="${post.image}" alt="รูป" class="table-image">` : "ไม่มีรูป"}</td>
                <td>${post.timestamp}</td>
                <td>${post.views}</td>
                <td><button class="delete-btn" onclick="deletePost(${post.id}, false)">ลบ</button></td>
            `;
            row.onclick = (e) => {
                if (e.target.className !== "delete-btn") showPostWindow(post, true);
            };
            tableBody.appendChild(row);
        });

        renderPagination(privatePosts.length, "pagination", currentPage, (page) => {
            currentPage = page;
            renderPrivateTable();
        });
    };
}

// แสดงตารางโพสต์สาธารณะ
async function renderPublicTable() {
    let tableBody = document.getElementById("publicTableBody");
    tableBody.innerHTML = "";
    try {
        await fetchCsrfToken();
        const response = await fetch("http://localhost:3333/api/posts/public", { credentials: "include" });
        if (!response.ok) throw new Error(await response.text());
        const serverPosts = await response.json();
        let start = (publicPage - 1) * postsPerPage;
        let end = start + postsPerPage;
        let paginatedPosts = serverPosts.slice(start, end);

        for (const post of paginatedPosts) {
            const commentResponse = await fetch(`http://localhost:3333/api/comments?postId=${post.id}`, { credentials: "include" });
            const comments = commentResponse.ok ? await commentResponse.json() : [];
            let row = document.createElement("tr");
            row.innerHTML = `
                <td class="id-column">${post.id}</td>
                <td>${post.author}</td>
                <td><pre>${post.content || "ไม่มีข้อความ"}</pre></td>
                <td>${post.image ? `<img src="http://localhost:3333${post.image}" alt="รูป" class="table-image">` : "ไม่มีรูป"}</td>
                <td>${post.timestamp}</td>
                <td>${post.views} (คอมเมนต์: ${comments.length})</td>
                ${post.author === currentUser ? `<td><button class="delete-btn" onclick="deletePost(${post.id}, true)">ลบ</button></td>` : `<td></td>`}
            `;
            row.onclick = (e) => {
                if (e.target.className !== "delete-btn") showPostWindow(post, post.author === currentUser);
            };
            tableBody.appendChild(row);
        }

        renderPagination(serverPosts.length, "publicPagination", publicPage, (page) => {
            publicPage = page;
            renderPublicTable();
        });
    } catch (error) {
        console.error("Error fetching public posts:", error);
        tableBody.innerHTML = `<tr><td colspan="7">เกิดข้อผิดพลาด: ${error.message}</td></tr>`;
    }
}

// Pagination
function renderPagination(totalPosts, paginationId, currentPageNum, onPageChange) {
    let paginationDiv = document.getElementById(paginationId);
    paginationDiv.innerHTML = "";
    let totalPages = Math.ceil(totalPosts / postsPerPage);

    let prevBtn = document.createElement("button");
    prevBtn.textContent = "หน้าก่อนหน้า";
    prevBtn.disabled = currentPageNum === 1;
    prevBtn.onclick = () => onPageChange(currentPageNum - 1);
    paginationDiv.appendChild(prevBtn);

    const maxButtons = 5;
    let startPage = Math.max(1, currentPageNum - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage + 1 < maxButtons) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        let btn = document.createElement("button");
        btn.textContent = i;
        btn.className = currentPageNum === i ? "active" : "";
        btn.onclick = () => onPageChange(i);
        paginationDiv.appendChild(btn);
    }

    let nextBtn = document.createElement("button");
    nextBtn.textContent = "หน้าถัดไป";
    nextBtn.disabled = currentPageNum === totalPages;
    nextBtn.onclick = () => onPageChange(currentPageNum + 1);
    paginationDiv.appendChild(nextBtn);
}

// อัปเดตวิว
function updateViews(id, change) {
    const transaction = db.transaction([postStoreName], "readwrite");
    const objectStore = transaction.objectStore(postStoreName);
    const request = objectStore.get(id);
    request.onsuccess = async function(event) {
        let post = event.target.result;
        post.views += change;
        if (post.views < 0) post.views = 0;
        const updateRequest = objectStore.put(post);
        updateRequest.onsuccess = function() {
            renderPosts();
            renderPrivateTable();
        };
        if (post.isPublic) {
            try {
                await fetchCsrfToken();
                await fetch(`http://localhost:3333/api/posts/${id}/views`, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${jwtToken}`,
                        "X-CSRF-Token": csrfToken
                    },
                    credentials: "include",
                    body: JSON.stringify({ views: change })
                });
            } catch (error) {
                console.error("Error updating server views:", error);
            }
        }
    };
}

// ลบโพสต์
async function deletePost(id, isServerPost = false) {
    if (!confirm("คุณต้องการลบโพสต์นี้หรือไม่?")) return;
    if (isServerPost) {
        try {
            await fetchCsrfToken();
            const response = await fetch(`http://localhost:3333/api/posts/${id}`, {
                method: "DELETE",
                headers: {
                    "Authorization": `Bearer ${jwtToken}`,
                    "X-CSRF-Token": csrfToken
                },
                credentials: "include"
            });
            if (!response.ok) throw new Error(await response.text());
            renderPublicTable();
        } catch (error) {
            console.error("Error deleting server post:", error);
            alert("เกิดข้อผิดพลาดในการลบโพสต์สาธารณะ: " + error.message);
        }
    } else {
        const transaction = db.transaction([postStoreName], "readwrite");
        const objectStore = transaction.objectStore(postStoreName);
        const request = objectStore.delete(id);
        request.onsuccess = function() {
            renderPosts();
            renderPrivateTable();
        };
        request.onerror = function(event) {
            console.error("Error deleting post:", event.target.error);
        };
    }
}

// ฟังก์ชันแก้ไขโพสต์
function startEditing(id) {
    const transaction = db.transaction([postStoreName], "readwrite");
    const objectStore = transaction.objectStore(postStoreName);
    const request = objectStore.get(id);
    request.onsuccess = function(event) {
        let post = event.target.result;
        post.isEditing = true;
        objectStore.put(post).onsuccess = function() {
            renderPosts();
        };
    };
}

function saveEdit(id) {
    const transaction = db.transaction([postStoreName], "readwrite");
    const objectStore = transaction.objectStore(postStoreName);
    const request = objectStore.get(id);
    request.onsuccess = async function(event) {
        let post = event.target.result;
        let textarea = document.getElementById(`edit-${id}`);
        post.content = textarea.value;
        post.isEditing = false;
        const updateRequest = objectStore.put(post);
        updateRequest.onsuccess = function() {
            renderPosts();
            renderPrivateTable();
        };
        if (post.isPublic) {
            try {
                await fetchCsrfToken();
                await fetch(`http://localhost:3333/api/posts/${id}`, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${jwtToken}`,
                        "X-CSRF-Token": csrfToken
                    },
                    credentials: "include",
                    body: JSON.stringify({ content: post.content })
                });
            } catch (error) {
                console.error("Error updating server post:", error);
            }
        }
    };
}

// สลับแท็บ
function switchTab(tabId) {
    document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
    document.querySelectorAll(".tab-buttons button").forEach(btn => btn.classList.remove("active"));
    document.getElementById(tabId).classList.add("active");
    document.querySelector(`button[onclick="switchTab('${tabId}')"]`).classList.add("active");
    if (tabId === "viewTab") renderPrivateTable();
    if (tabId === "publicTab") renderPublicTable();
}

// ฟังก์ชันลากวาง
function makeDraggable(element) {
    let isDragging = false;
    let offsetX, offsetY;
    element.style.position = "absolute";
    if (!element.style.left) element.style.left = "0px";
    if (!element.style.top) element.style.top = "0px";

    element.onmousedown = function(e) {
        if (!e.target.closest(".traffic-lights") && e.target.tagName !== "BUTTON" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
            isDragging = true;
            const rect = element.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            element.style.zIndex = parseInt(element.style.zIndex || 50) + 1;
            if (element.style.zIndex > 99) element.style.zIndex = 99;
            e.preventDefault();
        }
    };

    document.onmousemove = function(e) {
        if (isDragging) {
            let newX = e.clientX - offsetX;
            let newY = e.clientY - offsetY;
            const rect = element.getBoundingClientRect();
            newX = Math.max(0, Math.min(newX, window.innerWidth - rect.width));
            newY = Math.max(0, Math.min(newY, window.innerHeight - rect.height));
            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;
        }
    };

    document.onmouseup = function() {
        isDragging = false;
    };
}

function dragContent(event, postId) {
    event.dataTransfer.setData("text/plain", postId);
}

function allowDrop(event) {
    event.preventDefault();
}

function drop(event) {
    event.preventDefault();
    const postId = event.dataTransfer.getData("text/plain");
    // เพิ่มโค้ดสำหรับการลากโพสต์ไปวางถ้าต้องการ
}
// Add after existing variables at the top
const backgrounds = [
    'bg.png','01.png', '02.png', '03.png', '04.png',
    '05.png', '06.png', '07.png', '08.png'
];
let currentBackground = localStorage.getItem('selectedBackground') || 'bg.png';

// Add to window.onload function
window.onload = async function() {
    initDB();
    makeDraggable(document.getElementById("loginPage"));
    makeDraggable(document.getElementById("mainPage"));
    makeDraggable(document.getElementById("serverLoginPage"));
    await fetchCsrfToken();
    createBackgroundSelector(); // Add this line
    applyBackground(currentBackground); // Add this line
};

// New function to create background selector
function createBackgroundSelector() {
    const selector = document.createElement('div');
    selector.className = 'background-selector';
    
    backgrounds.forEach(bg => {
        const btn = document.createElement('button');
        btn.style.backgroundImage = `url('${bg}')`;
        btn.title = bg; // Tooltip showing filename
        if (bg === currentBackground) {
            btn.classList.add('active');
        }
        btn.onclick = () => changeBackground(bg);
        selector.appendChild(btn);
    });
    
    document.body.appendChild(selector);
}

// New function to change background
function changeBackground(bgFile) {
    currentBackground = bgFile;
    localStorage.setItem('selectedBackground', bgFile);
    
    // Update active state in selector
    const buttons = document.querySelectorAll('.background-selector button');
    buttons.forEach(btn => {
        if (btn.style.backgroundImage.includes(bgFile)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    applyBackground(bgFile);
}

// New function to apply background
function applyBackground(bgFile) {
    document.body.style.backgroundImage = `url('${bgFile}')`;
}