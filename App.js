import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { AnimatePresence, motion } from 'framer-motion';
import { Home, PlusCircle, Trash2, Wallet, User, Info, CheckCircle, XCircle } from 'lucide-react'; // For icons

// Ensure global variables are defined, or provide defaults for local testing
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Utility function to generate a short UUID
const generateShortId = () => {
    return 'xxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// Main App Component
const App = () => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [userName, setUserName] = useState('');
    const [userBalance, setUserBalance] = useState(0);
    const [activeCheques, setActiveCheques] = useState([]);
    const [currentPage, setCurrentPage] = useState('home'); // 'home', 'create', 'activate', 'delete', 'profile', 'wallet', 'terms'
    const [createStep, setCreateStep] = useState(0); // 0: enter amount, 1: confirm details
    const [createAmount, setCreateAmount] = useState('');
    const [createIsAnonymous, setCreateIsAnonymous] = useState(false);
    const [activateChequeId, setActivateChequeId] = useState('');
    const [message, setMessage] = useState({ text: '', type: '' }); // type: 'success', 'error', 'info'
    const [showModal, setShowModal] = useState(false);
    const [modalContent, setModalContent] = useState({ title: '', message: '', onConfirm: null, onCancel: null });
    const [loading, setLoading] = useState(true);

    // Initialize Firebase and authenticate
    useEffect(() => {
        try {
            const firebaseApp = initializeApp(firebaseConfig);
            const firestore = getFirestore(firebaseApp);
            const firebaseAuth = getAuth(firebaseApp);

            setDb(firestore);
            setAuth(firebaseAuth);

            // Listen for auth state changes
            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    // Fetch or create user document
                    const userDocRef = doc(firestore, 'artifacts', appId, 'users', user.uid, 'data', 'profile');
                    const userDocSnap = await getDoc(userDocRef);

                    if (!userDocSnap.exists()) {
                        // Create user profile if it doesn't exist
                        await setDoc(userDocRef, {
                            first_name: user.displayName || 'Пользователь',
                            username: user.email ? user.email.split('@')[0] : `user-${user.uid.substring(0, 8)}`,
                            balance: 0,
                            join_date: new Date().toISOString(),
                        });
                        setUserName(user.displayName || 'Пользователь');
                        setUserBalance(0);
                    } else {
                        const userData = userDocSnap.data();
                        setUserName(userData.first_name || 'Пользователь');
                        setUserBalance(userData.balance || 0);
                    }
                    setLoading(false);
                } else {
                    // Sign in anonymously if no initial token or user
                    if (initialAuthToken) {
                        try {
                            await signInWithCustomToken(firebaseAuth, initialAuthToken);
                        } catch (error) {
                            console.error("Error signing in with custom token:", error);
                            await signInAnonymously(firebaseAuth);
                        }
                    } else {
                        await signInAnonymously(firebaseAuth);
                    }
                    setLoading(false);
                }
            });

            return () => unsubscribe(); // Cleanup auth listener
        } catch (error) {
            console.error("Firebase initialization failed:", error);
            setMessage({ text: 'Ошибка инициализации Firebase.', type: 'error' });
            setLoading(false);
        }
    }, []);

    // Subscribe to real-time updates for user balance and cheques
    useEffect(() => {
        if (!db || !userId) return;

        // User profile snapshot listener
        const userProfileRef = doc(db, 'artifacts', appId, 'users', userId, 'data', 'profile');
        const unsubscribeProfile = onSnapshot(userProfileRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setUserBalance(data.balance || 0);
                setUserName(data.first_name || 'Пользователь');
            }
        }, (error) => console.error("Error fetching user profile:", error));

        // Active cheques snapshot listener for the current user
        const chequesCollectionRef = collection(db, 'artifacts', appId, 'users', userId, 'cheques');
        const q = query(chequesCollectionRef, where('active', '==', 1)); // Only active cheques
        const unsubscribeCheques = onSnapshot(q, (snapshot) => {
            const cheques = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setActiveCheques(cheques);
        }, (error) => console.error("Error fetching cheques:", error));

        return () => {
            unsubscribeProfile();
            unsubscribeCheques();
        };
    }, [db, userId]);

    // Show a message to the user
    const showMessage = useCallback((text, type = 'info', duration = 3000) => {
        setMessage({ text, type });
        setTimeout(() => setMessage({ text: '', type: '' }), duration);
    }, []);

    // Handle balance changes in Firestore
    const changeBalance = useCallback(async (amount) => {
        if (!db || !userId) return;
        try {
            const userDocRef = doc(db, 'artifacts', appId, 'users', userId, 'data', 'profile');
            await updateDoc(userDocRef, {
                balance: userBalance + amount
            });
            showMessage(`Баланс успешно обновлен на ${amount.toFixed(2)}$`, 'success');
        } catch (error) {
            console.error("Error changing balance:", error);
            showMessage('Ошибка обновления баланса.', 'error');
        }
    }, [db, userId, userBalance, showMessage]);

    // Handle creating a new cheque
    const handleCreateCheque = useCallback(async () => {
        if (!db || !userId) return;

        const amount = parseFloat(createAmount);
        if (isNaN(amount) || amount <= 0) {
            showMessage('Пожалуйста, введите корректную сумму.', 'error');
            return;
        }

        if (amount > userBalance) {
            showMessage('Недостаточно средств на балансе.', 'error');
            return;
        }

        setLoading(true);
        try {
            const chequeId = generateShortId(); // Use a simple short ID for display
            const fullChequeId = `${userId}-${chequeId}`; // Unique ID for Firestore

            // Decrement sender's balance
            await changeBalance(-amount);

            // Add cheque to sender's 'cheques' subcollection
            const senderChequeDocRef = doc(db, 'artifacts', appId, 'users', userId, 'cheques', fullChequeId);
            await setDoc(senderChequeDocRef, {
                short_id: chequeId,
                owner_id: userId,
                amount: amount,
                active: 1, // Active cheque
                anonymous: createIsAnonymous,
                created_at: new Date().toISOString(),
                // Store a copy in a public collection for easy lookup during activation
                // This is a simplified approach, in a real app you might have a dedicated 'cheques' collection
                // and use security rules to control access.
            });

            // Store the cheque in a public collection accessible to all users for activation
            const publicChequeDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'cheques', fullChequeId);
            await setDoc(publicChequeDocRef, {
                short_id: chequeId,
                owner_id: userId,
                amount: amount,
                active: 1,
                anonymous: createIsAnonymous,
                created_at: new Date().toISOString(),
                // Include owner_first_name for display during activation
                owner_first_name: userName,
                owner_username: auth.currentUser?.email ? auth.currentUser.email.split('@')[0] : `user-${userId.substring(0, 8)}`
            });

            showMessage(`Чек на сумму $${amount.toFixed(2)} успешно создан! ID: ${chequeId}`, 'success');
            setCreateAmount('');
            setCreateIsAnonymous(false);
            setCreateStep(0);
            setCurrentPage('home'); // Go back to home after creation
        } catch (error) {
            console.error("Error creating cheque:", error);
            showMessage('Ошибка при создании чека.', 'error');
        } finally {
            setLoading(false);
        }
    }, [db, userId, userBalance, createAmount, createIsAnonymous, changeBalance, userName, auth, showMessage]);

    // Handle activating a cheque
    const handleActivateCheque = useCallback(async () => {
        if (!db || !userId) return;

        if (!activateChequeId) {
            showMessage('Пожалуйста, введите ID чека.', 'error');
            return;
        }

        setLoading(true);
        try {
            // Find the cheque in the public collection
            const publicChequesRef = collection(db, 'artifacts', appId, 'public', 'data', 'cheques');
            const q = query(publicChequesRef, where('short_id', '==', activateChequeId));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                showMessage('Данного чека не существует.', 'error');
                setLoading(false);
                return;
            }

            let chequeData = null;
            let chequeRef = null;
            let fullChequeId = null;

            // Iterate through results to find an active cheque
            for (const docSnap of querySnapshot.docs) {
                const data = docSnap.data();
                if (data.active === 1) {
                    chequeData = data;
                    chequeRef = docSnap.ref;
                    fullChequeId = docSnap.id;
                    break;
                }
            }

            if (!chequeData) {
                showMessage('Данный чек был активирован или удалён.', 'error');
                setLoading(false);
                return;
            }

            if (chequeData.owner_id === userId) {
                showMessage('Вы не можете активировать свой чек.', 'error');
                setLoading(false);
                return;
            }

            // Deactivate the cheque in both public and sender's collection
            await updateDoc(chequeRef, { active: 0 }); // Public cheque
            const senderChequeDocRef = doc(db, 'artifacts', appId, 'users', chequeData.owner_id, 'cheques', fullChequeId);
            await updateDoc(senderChequeDocRef, { active: 0 }); // Sender's private cheque

            // Increment receiver's balance
            await changeBalance(chequeData.amount);

            // Optionally notify sender (requires cloud functions or more complex logic for web)
            // For now, we'll just show a message to the activator

            let messageText = '';
            if (chequeData.anonymous) {
                messageText = `💰 Вы активировали анонимный чек на сумму $${chequeData.amount.toFixed(2)}.`;
            } else {
                messageText = `💰 Вы активировали чек от ${chequeData.owner_first_name} (@${chequeData.owner_username}) на сумму $${chequeData.amount.toFixed(2)}.`;
            }

            showMessage(messageText, 'success');
            setActivateChequeId('');
            setCurrentPage('home'); // Go back to home after activation
        } catch (error) {
            console.error("Error activating cheque:", error);
            showMessage('Ошибка при активации чека.', 'error');
        } finally {
            setLoading(false);
        }
    }, [db, userId, activateChequeId, changeBalance, showMessage]);

    // Handle deleting a cheque
    const handleDeleteCheque = useCallback((cheque) => {
        setModalContent({
            title: 'Подтверждение удаления',
            message: `Вы действительно хотите удалить чек ${cheque.short_id} на сумму $${cheque.amount.toFixed(2)}?`,
            onConfirm: async () => {
                if (!db || !userId) return;
                setLoading(true);
                try {
                    // Delete from sender's private collection
                    const senderChequeDocRef = doc(db, 'artifacts', appId, 'users', userId, 'cheques', cheque.id);
                    await updateDoc(senderChequeDocRef, { active: 0 }); // Mark as inactive

                    // Delete from public collection
                    const publicChequeDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'cheques', cheque.id);
                    await updateDoc(publicChequeDocRef, { active: 0 }); // Mark as inactive

                    // Return amount to owner
                    await changeBalance(cheque.amount);

                    showMessage(`Чек ${cheque.short_id} был успешно удален. Сумма $${cheque.amount.toFixed(2)} возвращена на баланс.`, 'success');
                } catch (error) {
                    console.error("Error deleting cheque:", error);
                    showMessage('Ошибка при удалении чека.', 'error');
                } finally {
                    setLoading(false);
                    setShowModal(false);
                }
            },
            onCancel: () => setShowModal(false)
        });
        setShowModal(true);
    }, [db, userId, changeBalance, showMessage]);


    // Placeholder for "Пополнить баланс" - in a real app, this would integrate with a payment gateway
    const handleWalletTopUp = useCallback(() => {
        setModalContent({
            title: 'Пополнение баланса',
            message: 'Функционал пополнения баланса находится в разработке. Для реального использования потребуется интеграция с платежной системой.',
            onConfirm: () => setShowModal(false),
            onCancel: null
        });
        setShowModal(true);
    }, []);

    // Placeholder for terms agreement
    const handleTerms = useCallback(() => {
        setModalContent({
            title: 'Лицензионное соглашение',
            message: `
                <p><b>Лицензионное соглашение веб-приложения «Bill Activator»</b></p>
                <p>Актуальная редакция от ${new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}.</p>
                <p>Наш сервис не взимает комиссию за операции. Вы можете создавать неограниченное количество чеков на любые суммы.</p>
                <p><b>Важно: Данное веб-приложение не является официальным продуктом Telegram. Все операции осуществляются пользователями добровольно и под их личную ответственность.</b></p>
                <p>Продолжая использовать приложение, вы соглашаетесь с этими условиями.</p>
            `,
            onConfirm: () => setShowModal(false),
            onCancel: null
        });
        setShowModal(true);
    }, []);


    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-900 to-blue-700 text-white">
                <div className="text-xl font-semibold animate-pulse">Загрузка...</div>
            </div>
        );
    }

    const PageContainer = ({ children, pageKey }) => (
        <motion.div
            key={pageKey}
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            transition={{ duration: 0.3 }}
            className="w-full flex-grow flex flex-col items-center justify-start p-4 overflow-y-auto"
        >
            {children}
        </motion.div>
    );

    const commonClasses = {
        button: "w-full py-3 px-6 rounded-xl shadow-lg flex items-center justify-center text-lg font-semibold transition-all duration-300 ease-in-out transform hover:scale-105 active:scale-95",
        input: "w-full p-3 rounded-xl bg-blue-800 text-white text-lg focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder-blue-300 transition-all duration-300 ease-in-out",
        card: "bg-blue-800 bg-opacity-70 backdrop-blur-sm rounded-2xl p-6 shadow-2xl w-full max-w-sm transition-all duration-300 ease-in-out transform hover:shadow-blue-500/50",
        message: "p-3 rounded-xl text-center text-white font-medium mb-4 transition-all duration-300 ease-in-out",
    };

    return (
        <div className="relative min-h-screen bg-gradient-to-br from-blue-900 to-blue-700 text-white font-inter flex flex-col items-center">
            {/* Background Animations */}
            <div className="absolute inset-0 overflow-hidden z-0">
                <div className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob-one"></div>
                <div className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob-two animation-delay-2000"></div>
                <div className="absolute top-1/2 left-1/4 w-1/3 h-1/3 bg-blue-400 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob-three animation-delay-4000"></div>
            </div>

            <div className="relative z-10 flex flex-col items-center w-full max-w-md mx-auto min-h-screen">
                <header className="w-full p-4 flex justify-between items-center bg-blue-900 bg-opacity-80 backdrop-blur-md rounded-b-3xl shadow-xl z-20 sticky top-0">
                    <motion.h1
                        className="text-3xl font-bold text-blue-100"
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.2 }}
                    >
                        Bill Activator
                    </motion.h1>
                    <motion.div
                        className="flex items-center"
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.4 }}
                    >
                        <User className="w-6 h-6 text-blue-300 mr-2" />
                        <span className="text-xl font-medium text-blue-200">{userName}</span>
                    </motion.div>
                </header>

                <main className="flex-grow w-full flex flex-col items-center p-4 pt-8 z-10">
                    {message.text && (
                        <motion.div
                            initial={{ opacity: 0, y: -20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className={`${commonClasses.message} ${message.type === 'success' ? 'bg-green-600' : message.type === 'error' ? 'bg-red-600' : 'bg-blue-600'}`}
                        >
                            {message.text}
                        </motion.div>
                    )}

                    <AnimatePresence mode='wait'>
                        {currentPage === 'home' && (
                            <PageContainer pageKey="home">
                                <motion.div
                                    className={`${commonClasses.card} text-center`}
                                    initial={{ scale: 0.8, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ duration: 0.5, type: "spring", stiffness: 120 }}
                                >
                                    <h2 className="text-3xl font-bold mb-2 text-blue-100">Ваш баланс</h2>
                                    <motion.p
                                        className="text-5xl font-extrabold text-blue-50 tracking-wide"
                                        initial={{ y: 20, opacity: 0 }}
                                        animate={{ y: 0, opacity: 1 }}
                                        transition={{ delay: 0.3, duration: 0.5 }}
                                    >
                                        ${userBalance.toFixed(2)}
                                    </motion.p>
                                    <motion.button
                                        className={`${commonClasses.button} bg-blue-600 hover:bg-blue-500 mt-6 text-blue-100`}
                                        onClick={handleWalletTopUp}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                    >
                                        <Wallet className="w-5 h-5 mr-2" /> Пополнить баланс
                                    </motion.button>
                                </motion.div>

                                <motion.button
                                    className={`${commonClasses.button} bg-purple-600 hover:bg-purple-500 mt-6 text-blue-100`}
                                    onClick={() => setCurrentPage('create')}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.4, duration: 0.5 }}
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                >
                                    <PlusCircle className="w-5 h-5 mr-2" /> Создать чек
                                </motion.button>

                                <motion.button
                                    className={`${commonClasses.button} bg-green-600 hover:bg-green-500 mt-4 text-blue-100`}
                                    onClick={() => setCurrentPage('activate')}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.5, duration: 0.5 }}
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                >
                                    <CheckCircle className="w-5 h-5 mr-2" /> Активировать чек
                                </motion.button>

                                <motion.button
                                    className={`${commonClasses.button} bg-red-600 hover:bg-red-500 mt-4 text-blue-100`}
                                    onClick={() => setCurrentPage('delete')}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.6, duration: 0.5 }}
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                >
                                    <Trash2 className="w-5 h-5 mr-2" /> Удалить чек
                                </motion.button>

                                <motion.button
                                    className={`${commonClasses.button} bg-gray-700 hover:bg-gray-600 mt-4 text-blue-100`}
                                    onClick={handleTerms}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.7, duration: 0.5 }}
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                >
                                    <Info className="w-5 h-5 mr-2" /> Лицензионное соглашение
                                </motion.button>

                            </PageContainer>
                        )}

                        {currentPage === 'create' && (
                            <PageContainer pageKey="create">
                                <motion.div
                                    className={`${commonClasses.card} text-center`}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    <h2 className="text-2xl font-bold mb-4 text-blue-100">Создание нового чека</h2>
                                    {createStep === 0 && (
                                        <>
                                            <motion.p
                                                className="text-blue-200 mb-4"
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                transition={{ delay: 0.2 }}
                                            >
                                                Отправьте сумму чека:
                                            </motion.p>
                                            <motion.input
                                                type="number"
                                                step="0.01"
                                                placeholder="Например, 10.50"
                                                value={createAmount}
                                                onChange={(e) => setCreateAmount(e.target.value)}
                                                className={`${commonClasses.input} mb-4`}
                                                initial={{ y: 10, opacity: 0 }}
                                                animate={{ y: 0, opacity: 1 }}
                                                transition={{ delay: 0.3 }}
                                            />
                                            <motion.button
                                                className={`${commonClasses.button} bg-blue-600 hover:bg-blue-500 text-blue-100`}
                                                onClick={() => setCreateStep(1)}
                                                disabled={!createAmount || parseFloat(createAmount) <= 0}
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                            >
                                                Далее
                                            </motion.button>
                                            <motion.button
                                                className={`${commonClasses.button} bg-gray-700 hover:bg-gray-600 text-blue-100 mt-2`}
                                                onClick={() => setCurrentPage('home')}
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                            >
                                                Отмена
                                            </motion.button>
                                        </>
                                    )}
                                    {createStep === 1 && (
                                        <>
                                            <motion.p
                                                className="text-blue-200 mb-2"
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                transition={{ delay: 0.2 }}
                                            >
                                                Сумма чека: <b>${parseFloat(createAmount).toFixed(2)}</b>
                                            </motion.p>
                                            <motion.div
                                                className="flex items-center justify-center mb-4"
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                transition={{ delay: 0.3 }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    id="anonymous"
                                                    checked={createIsAnonymous}
                                                    onChange={(e) => setCreateIsAnonymous(e.target.checked)}
                                                    className="h-5 w-5 text-blue-600 rounded focus:ring-blue-500 mr-2"
                                                />
                                                <label htmlFor="anonymous" className="text-blue-200">
                                                    Анонимный чек
                                                </label>
                                            </motion.div>
                                            <motion.button
                                                className={`${commonClasses.button} bg-purple-600 hover:bg-purple-500 text-blue-100`}
                                                onClick={handleCreateCheque}
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                            >
                                                <PlusCircle className="w-5 h-5 mr-2" /> Создать чек
                                            </motion.button>
                                            <motion.button
                                                className={`${commonClasses.button} bg-gray-700 hover:bg-gray-600 text-blue-100 mt-2`}
                                                onClick={() => setCreateStep(0)}
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                            >
                                                <XCircle className="w-5 h-5 mr-2" /> Изменить сумму
                                            </motion.button>
                                            <motion.button
                                                className={`${commonClasses.button} bg-red-600 hover:bg-red-500 text-blue-100 mt-2`}
                                                onClick={() => { setCreateStep(0); setCreateAmount(''); setCreateIsAnonymous(false); setCurrentPage('home'); }}
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                            >
                                                Отменить создание
                                            </motion.button>
                                        </>
                                    )}
                                </motion.div>
                            </PageContainer>
                        )}

                        {currentPage === 'activate' && (
                            <PageContainer pageKey="activate">
                                <motion.div
                                    className={`${commonClasses.card} text-center`}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    <h2 className="text-2xl font-bold mb-4 text-blue-100">Активировать чек</h2>
                                    <motion.p
                                        className="text-blue-200 mb-4"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.2 }}
                                    >
                                        Введите ID чека:
                                    </motion.p>
                                    <motion.input
                                        type="text"
                                        placeholder="Введите ID чека"
                                        value={activateChequeId}
                                        onChange={(e) => setActivateChequeId(e.target.value)}
                                        className={`${commonClasses.input} mb-4`}
                                        initial={{ y: 10, opacity: 0 }}
                                        animate={{ y: 0, opacity: 1 }}
                                        transition={{ delay: 0.3 }}
                                    />
                                    <motion.button
                                        className={`${commonClasses.button} bg-green-600 hover:bg-green-500 text-blue-100`}
                                        onClick={handleActivateCheque}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                    >
                                        <CheckCircle className="w-5 h-5 mr-2" /> Активировать
                                    </motion.button>
                                    <motion.button
                                        className={`${commonClasses.button} bg-gray-700 hover:bg-gray-600 text-blue-100 mt-2`}
                                        onClick={() => setCurrentPage('home')}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                    >
                                        Отмена
                                    </motion.button>
                                </motion.div>
                            </PageContainer>
                        )}

                        {currentPage === 'delete' && (
                            <PageContainer pageKey="delete">
                                <motion.div
                                    className={`${commonClasses.card} text-center`}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    <h2 className="text-2xl font-bold mb-4 text-blue-100">Ваши активные чеки</h2>
                                    {activeCheques.length === 0 ? (
                                        <p className="text-blue-200">У вас нет активных чеков для удаления.</p>
                                    ) : (
                                        <ul className="space-y-3">
                                            <AnimatePresence>
                                                {activeCheques.map((cheque) => (
                                                    <motion.li
                                                        key={cheque.id}
                                                        className="flex justify-between items-center bg-blue-700 rounded-xl p-3 shadow-md"
                                                        initial={{ opacity: 0, x: -20 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        exit={{ opacity: 0, x: 20 }}
                                                        transition={{ duration: 0.2 }}
                                                    >
                                                        <span className="text-blue-100 font-medium">{cheque.short_id}</span>
                                                        <span className="text-blue-50 font-bold">${cheque.amount.toFixed(2)}</span>
                                                        <motion.button
                                                            className="text-red-400 hover:text-red-300 transition-colors duration-200"
                                                            onClick={() => handleDeleteCheque(cheque)}
                                                            whileHover={{ scale: 1.1 }}
                                                            whileTap={{ scale: 0.9 }}
                                                        >
                                                            <Trash2 className="w-5 h-5" />
                                                        </motion.button>
                                                    </motion.li>
                                                ))}
                                            </AnimatePresence>
                                        </ul>
                                    )}
                                    <motion.button
                                        className={`${commonClasses.button} bg-gray-700 hover:bg-gray-600 text-blue-100 mt-6`}
                                        onClick={() => setCurrentPage('home')}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                    >
                                        Назад
                                    </motion.button>
                                </motion.div>
                            </PageContainer>
                        )}
                    </AnimatePresence>
                </main>

                <footer className="w-full p-4 flex justify-around items-center bg-blue-900 bg-opacity-80 backdrop-blur-md rounded-t-3xl shadow-xl z-20 sticky bottom-0">
                    <motion.button
                        className="flex flex-col items-center text-blue-200 hover:text-blue-100 transition-colors duration-200"
                        onClick={() => setCurrentPage('home')}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                    >
                        <Home className="w-6 h-6 mb-1" />
                        <span className="text-xs">Главная</span>
                    </motion.button>
                    <motion.button
                        className="flex flex-col items-center text-blue-200 hover:text-blue-100 transition-colors duration-200"
                        onClick={() => setCurrentPage('create')}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                    >
                        <PlusCircle className="w-6 h-6 mb-1" />
                        <span className="text-xs">Создать</span>
                    </motion.button>
                    <motion.button
                        className="flex flex-col items-center text-blue-200 hover:text-blue-100 transition-colors duration-200"
                        onClick={() => setCurrentPage('activate')}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                    >
                        <CheckCircle className="w-6 h-6 mb-1" />
                        <span className="text-xs">Активировать</span>
                    </motion.button>
                </footer>

                {/* Modal Component */}
                <AnimatePresence>
                    {showModal && (
                        <motion.div
                            className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <motion.div
                                className="bg-blue-800 bg-opacity-90 rounded-2xl p-6 shadow-2xl w-full max-w-xs text-center"
                                initial={{ scale: 0.8, y: -50 }}
                                animate={{ scale: 1, y: 0 }}
                                exit={{ scale: 0.8, y: 50 }}
                                transition={{ type: "spring", stiffness: 200, damping: 20 }}
                            >
                                <h3 className="text-xl font-bold mb-4 text-blue-100">{modalContent.title}</h3>
                                <div className="text-blue-200 mb-6" dangerouslySetInnerHTML={{ __html: modalContent.message }} />
                                <div className="flex justify-center space-x-4">
                                    {modalContent.onConfirm && (
                                        <motion.button
                                            className={`${commonClasses.button} bg-blue-600 hover:bg-blue-500 text-blue-100 py-2 px-4 text-base`}
                                            onClick={modalContent.onConfirm}
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                        >
                                            OK
                                        </motion.button>
                                    )}
                                    {modalContent.onCancel && (
                                        <motion.button
                                            className={`${commonClasses.button} bg-gray-700 hover:bg-gray-600 text-blue-100 py-2 px-4 text-base`}
                                            onClick={modalContent.onCancel}
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                        >
                                            Отмена
                                        </motion.button>
                                    )}
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default App;

