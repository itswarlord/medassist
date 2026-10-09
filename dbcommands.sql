-- 1. Create the database
CREATE DATABASE medibot_db;

-- 2. Create a user (replace 'mypassword123' with your chosen password)
CREATE USER 'medibot_user'@'localhost' IDENTIFIED BY 'mypassword123';

-- 3. Grant full privileges on this database to the user
GRANT ALL PRIVILEGES ON medibot_db.* TO 'medibot_user'@'localhost';

-- 4. Apply the changes
FLUSH PRIVILEGES;

-- 5. Exit MySQL
EXIT;


USE medibot_db;

#medibot_user localhost mypassword123


CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(128) PRIMARY KEY,
    history_json JSON NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
