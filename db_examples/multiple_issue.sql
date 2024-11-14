DO $$ 
BEGIN
    -- Problema 1: Falta IF NOT EXISTS na tabela
    CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        total DECIMAL(10,2)
    );

    -- Problema 2: Falta IF NOT EXISTS na constraint
    ALTER TABLE orders 
    ADD CONSTRAINT fk_user 
    FOREIGN KEY (user_id) 
    REFERENCES users(id);

    -- Problema 3: Falta verificação de duplicatas
    INSERT INTO orders (user_id, total)
    VALUES (1, 99.99);
END $$;